// X视频下载助手 - 后台脚本

// 启用调试输出
const DEBUG = true;

// 记录日志
function log(...args) {
  if (DEBUG) {
    console.log('[X视频下载助手-BG]', ...args);
  }
}

// 默认设置
const defaultSettings = {
  enableDownloadBtn: true,
  enableHighQuality: true,
  enableBatchDownload: true,
  lastUpdated: Date.now()
};

// 视频URL缓存 - 用于避免重复请求相同的URL
const videoUrlCache = new Map();
const VIDEO_CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 设置缓存有效期为24小时

// 正则表达式模式集合
const VIDEO_PATTERNS = [
  // 标准Twitter视频源
  /(https:\/\/video\.twimg\.com\/[^"'\s]+\.mp4)/g,
  // 匹配<video>标签中的src属性
  /<video[^>]*src=["']([^"']+)["'][^>]*>/gi,
  // 匹配<source>标签中的src属性
  /<source[^>]*src=["']([^"']+)["'][^>]*>/gi,
  // 匹配JavaScript变量中的JSON视频URL
  /videoUrl["'\s]*:["'\s]*([^"'\s,\}]+)/gi,
  // 匹配API响应中的video_info结构
  /"video_info"\s*:\s*\{[^}]*"variants"\s*:\s*\[(.*?)\]/gs,
  // 匹配视频变体数组中的URL
  /"url"\s*:\s*"([^"]+)"/g,
  // 匹配媒体实体中的视频URL
  /"media_url_https"\s*:\s*"([^"]+)"/g,
  // 匹配扩展视频信息
  /"video"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/gs,
  // 匹配HTML页面中的og:video元标签
  /<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i,
  // 匹配HTML页面中带有视频class的div内的src属性
  /<div[^>]*class=["'][^"']*video[^"']*["'][^>]*>.*?src=["']([^"']+)["']/gis,
  // 匹配播放列表文件
  /(https:\/\/[^"'\s]+\.m3u8[^"'\s]*)/g,
];

// 注入内容脚本
async function injectScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      function: grabVideoLinksFromPage
    });
  } catch (e) {
    log('注入脚本错误:', e);
  }
}

// 在页面中抓取视频链接的函数
function grabVideoLinksFromPage() {
  // 这个函数将在目标页面环境中执行
  // 收集所有可能包含视频URL的脚本标签内容
  const videoUrls = [];
  
  // 查找页面中的所有视频元素
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    if (video.src && !video.src.startsWith('blob:')) {
      videoUrls.push(video.src);
    }
    
    const sources = video.querySelectorAll('source');
    sources.forEach(source => {
      if (source.src) {
        videoUrls.push(source.src);
      }
    });
  });
  
  // 尝试从页面的脚本中提取视频URL
  const scripts = document.querySelectorAll('script');
  scripts.forEach(script => {
    if (script.textContent) {
      // 尝试查找包含mp4或视频相关信息的脚本
      if (script.textContent.includes('.mp4') || 
          script.textContent.includes('video_url') || 
          script.textContent.includes('videoUrl')) {
        
        // 查找mp4 URL
        const mp4Matches = script.textContent.match(/(https:\/\/[^"'\s]+\.mp4[^"'\s]*)/g);
        if (mp4Matches) {
          videoUrls.push(...mp4Matches);
        }
      }
    }
  });
  
  return videoUrls;
}

// 解析视频URL，增强版
function parseVideoUrlFromResponse(responseText, tweetId) {
  if (!responseText) return null;
  
  log('开始从响应中解析视频URL，推文ID:', tweetId);
  
  let highestQualityUrl = null;
  let highestBitrate = 0;
  
  // 方法1: 尝试从响应中提取媒体实体和视频变体
  try {
    // 解析JSON响应
    const jsonMatch = responseText.match(/({[\s\S]*})/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const jsonResponse = JSON.parse(jsonMatch[1]);
        
        // 检查是否有媒体对象
        if (jsonResponse && jsonResponse.data && jsonResponse.data.threaded_conversation_with_injections_v2) {
          const instructions = jsonResponse.data.threaded_conversation_with_injections_v2.instructions;
          
          for (const instruction of instructions || []) {
            const entries = instruction.entries || [];
            
            for (const entry of entries) {
              if (entry.content && entry.content.itemContent && 
                  entry.content.itemContent.tweet_results && 
                  entry.content.itemContent.tweet_results.result) {
                  
                const tweet = entry.content.itemContent.tweet_results.result;
                
                // 检查推文是否包含媒体
                if (tweet.legacy && tweet.legacy.entities && tweet.legacy.entities.media) {
                  for (const media of tweet.legacy.entities.media) {
                    if (media.type === 'video' && media.video_info && media.video_info.variants) {
                      // 查找最高质量的视频
                      for (const variant of media.video_info.variants) {
                        if (variant.content_type === 'video/mp4' && variant.bitrate && variant.bitrate > highestBitrate) {
                          highestBitrate = variant.bitrate;
                          highestQualityUrl = variant.url;
                        }
                      }
                    }
                  }
                }
                
                // 扩展媒体实体检查
                if (tweet.legacy && tweet.legacy.extended_entities && tweet.legacy.extended_entities.media) {
                  for (const media of tweet.legacy.extended_entities.media) {
                    if (media.type === 'video' && media.video_info && media.video_info.variants) {
                      // 查找最高质量的视频
                      for (const variant of media.video_info.variants) {
                        if (variant.content_type === 'video/mp4' && variant.bitrate && variant.bitrate > highestBitrate) {
                          highestBitrate = variant.bitrate;
                          highestQualityUrl = variant.url;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        log('JSON解析失败:', e);
      }
    }
  } catch (e) {
    log('尝试方法1解析失败:', e);
  }
  
  // 如果已找到高质量URL，返回
  if (highestQualityUrl) {
    log('从JSON响应中找到高质量视频URL:', highestQualityUrl);
    return highestQualityUrl;
  }
  
  // 方法2: 使用正则表达式模式集合查找视频URL
  let allVideoUrls = [];
  let mp4Urls = [];
  
  for (const pattern of VIDEO_PATTERNS) {
    const matches = Array.from(responseText.matchAll(pattern));
    
    for (const match of matches) {
      const url = match[1];
      if (url && url.includes('https://') && !url.includes('"') && !url.includes("'")) {
        allVideoUrls.push(url);
        
        // 收集MP4URLs
        if (url.toLowerCase().includes('.mp4')) {
          mp4Urls.push(url);
        }
      }
    }
  }
  
  log(`使用正则表达式找到 ${allVideoUrls.length} 个潜在视频URL，其中MP4: ${mp4Urls.length}`);
  
  // 首选MP4视频
  if (mp4Urls.length > 0) {
    // 尝试找到最高质量的视频（通常包含像素级信息）
    for (const url of mp4Urls) {
      if (url.includes('720p') || url.includes('1080p') || url.includes('720x') || url.includes('1080x')) {
        log('找到高分辨率MP4:', url);
        return url;
      }
    }
    
    // 返回最长的URL（通常包含更多参数，可能是质量更高的版本）
    mp4Urls.sort((a, b) => b.length - a.length);
    log('返回找到的最长MP4 URL:', mp4Urls[0]);
    return mp4Urls[0];
  }
  
  // 如果没有MP4，返回找到的任何视频URL
  if (allVideoUrls.length > 0) {
    log('没有找到MP4，返回其他类型视频URL:', allVideoUrls[0]);
    return allVideoUrls[0];
  }
  
  // 方法3: 尝试解析HTML内容中的视频URL
  if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
    // 尝试从meta标签中提取视频URL
    const metaMatch = responseText.match(/<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i);
    if (metaMatch && metaMatch[1]) {
      log('从meta标签中找到视频URL:', metaMatch[1]);
      return metaMatch[1];
    }
    
    // 尝试从JSON-LD中提取
    const jsonLdMatch = responseText.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        if (jsonLd && jsonLd.video && jsonLd.video.contentUrl) {
          log('从JSON-LD中找到视频URL:', jsonLd.video.contentUrl);
          return jsonLd.video.contentUrl;
        }
      } catch (e) {
        log('JSON-LD解析失败:', e);
      }
    }
  }
  
  log('无法从响应中提取视频URL');
  return null;
}

// 新增：请求队列和限速机制
const requestQueue = [];
let isProcessingQueue = false;
const requestDelay = 3000; // 增加请求间隔时间到3秒以减少429错误
const maxRetries = 3; // 最大重试次数
const retryDelay = 5000; // 重试延迟时间(毫秒)

// 增强的限速请求函数 - 加入重试和更多限制
async function throttledFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    // 添加到请求队列
    requestQueue.push({
      url,
      options,
      resolve,
      reject,
      retries: 0
    });
    
    // 如果队列没有在处理，开始处理
    if (!isProcessingQueue) {
      processRequestQueue();
    }
  });
}

// 增强的处理请求队列
async function processRequestQueue() {
  if (requestQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }
  
  isProcessingQueue = true;
  const request = requestQueue.shift();
  
  try {
    log(`执行限速请求: ${request.url} (尝试次数: ${request.retries + 1})`);
    
    // 添加随机User-Agent避免被识别为机器人
    if (!request.options.headers) {
      request.options.headers = {};
    }
    
    // 如果没有设置User-Agent，使用随机User-Agent
    if (!request.options.headers['User-Agent']) {
      request.options.headers['User-Agent'] = getRandomUserAgent();
    }
    
    // 增加缓存控制以避免重复请求
    if (!request.options.cache) {
      // 对于API请求使用no-store以始终获取最新数据
      // 对于静态资源使用default以允许缓存
      request.options.cache = request.url.includes('api') ? 'no-store' : 'default';
    }
    
    // 执行请求
    const response = await fetch(request.url, request.options);
    
    // 处理429错误 (Too Many Requests)
    if (response.status === 429 && request.retries < maxRetries) {
      log(`请求受限(429)，将在${retryDelay/1000}秒后重试...`);
      
      // 增加重试计数，将请求重新加入队列末尾
      request.retries++;
      
      // 使用setTimeout延迟重试
      setTimeout(() => {
        requestQueue.push(request);
        // 如果队列没有在处理，开始处理
        if (!isProcessingQueue) {
          processRequestQueue();
        }
      }, retryDelay);
    } else {
      // 正常响应或其他错误
      request.resolve(response);
    }
  } catch (error) {
    log(`请求出错: ${error.message}`);
    
    // 网络错误重试
    if ((error.name === 'TypeError' || error.message.includes('network')) && 
        request.retries < maxRetries) {
      log(`网络错误，将在${retryDelay/1000}秒后重试...`);
      
      // 增加重试计数，将请求重新加入队列末尾
      request.retries++;
      
      // 使用setTimeout延迟重试
      setTimeout(() => {
        requestQueue.push(request);
        // 如果队列没有在处理，开始处理
        if (!isProcessingQueue) {
          processRequestQueue();
        }
      }, retryDelay);
    } else {
      // 达到最大重试次数或其他错误
      request.reject(error);
    }
  }
  
  // 延时处理下一个请求
  setTimeout(processRequestQueue, requestDelay);
}

// 获取随机User-Agent
function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// 新增：直接从视频播放页获取视频URL
async function fetchDirectVideoUrl(tweetId) {
  try {
    log('尝试直接获取视频URL，推文ID:', tweetId);
    
    const playerUrl = `https://twitter.com/i/videos/tweet/${tweetId}`;
    const response = await throttledFetch(playerUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Referer': `https://twitter.com/i/status/${tweetId}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`播放器页面请求失败: ${response.status}`);
    }
    
    const html = await response.text();
    
    // 尝试方法1: 查找播放器配置
    const configMatch = html.match(/playerConfig\s*=\s*({[\s\S]*?});/);
    if (configMatch && configMatch[1]) {
      try {
        // 清理JSON字符串
        const configStr = configMatch[1].replace(/\\n/g, '')
          .replace(/\\'/g, "'")
          .replace(/\\"/g, '"')
          .replace(/\\&/g, '&')
          .replace(/\\\//g, '/')
          .replace(/\\\\u/g, '\\u');
        
        // 尝试解析JSON
        const config = JSON.parse(configStr);
        
        // 查找播放URL
        if (config.playlist && config.playlist[0] && config.playlist[0].source) {
          const videoUrl = config.playlist[0].source;
          log('从播放器配置中找到视频URL:', videoUrl);
          return videoUrl;
        }
      } catch (e) {
        log('解析播放器配置失败:', e);
      }
    }
    
    // 尝试方法2: 从OG标签获取
    const ogVideoMatch = html.match(/<meta\s+property="og:video:url"\s+content="([^"]+)"/i);
    if (ogVideoMatch && ogVideoMatch[1]) {
      log('从og:video标签找到视频URL:', ogVideoMatch[1]);
      return ogVideoMatch[1];
    }
    
    // 尝试方法3: 查找任何mp4链接
    const mp4Match = html.match(/https:\/\/video\.twimg\.com\/[^"'\s]+\.mp4[^"'\s]*/g);
    if (mp4Match && mp4Match.length > 0) {
      // 选择第一个MP4链接
      log('从页面找到MP4链接:', mp4Match[0]);
      return mp4Match[0];
    }
  } catch (error) {
    log('直接获取视频URL失败:', error);
  }
  
  return null;
}

// 修改TwitterWeb API获取视频的方法，解决CORS问题
async function fetchTwitterWebApiVideo(tweetId) {
  try {
    log('尝试使用TwitterWeb API获取视频，推文ID:', tweetId);
    
    // 使用TwitterWeb API获取推文详情
    const apiUrl = `https://api.twitter.com/1.1/statuses/show.json?id=${tweetId}&include_entities=true`;
    
    const response = await throttledFetch(apiUrl, {
      // 修改为no-cors模式以绕过CORS限制
      mode: 'no-cors',
      headers: {
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA', // 公共Bearer Token
        'x-csrf-token': 'a56138e75f404d3c3282c46b8d633e05',
        'Accept': 'application/json'
      }
    });
    
    // 由于no-cors模式无法读取响应内容，直接尝试其他方法
    log('TwitterWeb API无法直接访问，尝试其他方法');
    return null;
  } catch (error) {
    log('TwitterWeb API获取视频失败:', error);
  }
  
  return null;
}

// 增强：使用直接的视频播放接口
async function fetchVideoPlaybackUrl(tweetId) {
  try {
    log('尝试使用视频播放接口获取视频，推文ID:', tweetId);
    
    // Twitter视频接口
    const apiUrl = `https://twitter.com/i/api/graphql/sITyJdhqpHF5Z8LITbLFKg/TweetWithVisibilityControl?variables=%7B%22tweetId%22%3A%22${tweetId}%22%2C%22withCommunity%22%3Afalse%7D`;
    
    const response = await throttledFetch(apiUrl, {
      method: 'GET',
      mode: 'no-cors', // 添加no-cors模式
      headers: {
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-twitter-client-language': 'en',
        'x-twitter-active-user': 'yes',
        'Accept': '*/*'
      }
    });
    
    // 由于no-cors模式无法读取响应内容，直接返回null
    log('视频播放接口无法直接访问，尝试其他方法');
    return null;
  } catch (error) {
    log('视频接口获取失败:', error);
  }
  
  return null;
}

// 获取缓存的视频URL，检查是否过期
function getCachedVideoUrl(tweetId) {
  if (videoUrlCache.has(tweetId)) {
    const cacheEntry = videoUrlCache.get(tweetId);
    
    // 检查缓存是否过期
    if (cacheEntry.timestamp && (Date.now() - cacheEntry.timestamp < VIDEO_CACHE_EXPIRY)) {
      log(`使用缓存的视频URL: ${cacheEntry.url}, 推文ID: ${tweetId}`);
      return cacheEntry.url;
    } else {
      // 缓存已过期，移除
      log(`缓存已过期，推文ID: ${tweetId}`);
      videoUrlCache.delete(tweetId);
    }
  }
  
  return null;
}

// 更新缓存视频URL，包含时间戳
function cacheVideoUrl(tweetId, url) {
  if (tweetId && url) {
    videoUrlCache.set(tweetId, {
      url: url,
      timestamp: Date.now()
    });
    log(`已缓存视频URL: ${url}, 推文ID: ${tweetId}`);
  }
}

// 修改获取推文内容方法，使用更新的缓存机制
async function fetchTweetContent(tweetId) {
  if (!tweetId) {
    log('无效的推文ID');
    return null;
  }
  
  log('尝试获取推文内容，ID:', tweetId);
  
  // 检查缓存
  const cachedUrl = getCachedVideoUrl(tweetId);
  if (cachedUrl) {
    return cachedUrl;
  }
  
  // 优先使用最可靠的方法
  // 尝试方法1: 直接视频地址
  let videoUrl = await fetchDirectVideoUrl(tweetId);
  
  // 如果方法1失败，尝试方法2: 使用视频播放接口
  if (!videoUrl) {
    videoUrl = await fetchVideoPlaybackUrl(tweetId);
  }
  
  // 如果前两种方法失败，尝试方法3: 使用FXTwitter API
  if (!videoUrl) {
    try {
      const fxUrl = `https://api.fxtwitter.com/status/${tweetId}`;
      log('尝试使用FXTwitter API获取视频:', fxUrl);
      
      const response = await throttledFetch(fxUrl);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data && data.tweet && data.tweet.media && 
            data.tweet.media.videos && data.tweet.media.videos.length > 0) {
          // 获取最高质量的视频
          let bestVideo = data.tweet.media.videos[0];
          
          for (const video of data.tweet.media.videos) {
            if (video.quality && 
                (video.quality.indexOf('720') >= 0 || 
                 video.quality.indexOf('1080') >= 0)) {
              bestVideo = video;
              break;
            }
          }
          
          if (bestVideo && bestVideo.url) {
            log('从FXTwitter获取到视频URL:', bestVideo.url);
            videoUrl = bestVideo.url;
          }
        }
      }
    } catch (error) {
      log('从FXTwitter获取视频失败:', error);
    }
  }
  
  // 如果前三种方法失败，尝试方法4: 从推文页面提取
  if (!videoUrl) {
    try {
      const tweetUrl = `https://twitter.com/i/status/${tweetId}`;
      log('尝试从推文页面提取视频URL:', tweetUrl);
      
      const response = await throttledFetch(tweetUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
        }
      });
      
      if (response.ok) {
        const responseText = await response.text();
        videoUrl = parseVideoUrlFromResponse(responseText, tweetId);
        
        if (videoUrl) {
          log('从推文页面获取到视频URL:', videoUrl);
        }
      }
    } catch (error) {
      log('从推文页面获取视频失败:', error);
    }
  }
  
  // 如果找到了视频URL，缓存并返回
  if (videoUrl) {
    cacheVideoUrl(tweetId, videoUrl);
    return videoUrl;
  }
  
  log('无法获取视频URL，所有方法都失败');
  return null;
}

// 从推文URL中提取ID
function extractTweetId(tweetUrl) {
  // 先尝试使用URL对象解析
  try {
    const url = new URL(tweetUrl);
    const pathParts = url.pathname.split('/');
    
    // 查找status后面的数字
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'status' || pathParts[i] === 'statuses') {
        if (i + 1 < pathParts.length && /^\d+$/.test(pathParts[i + 1])) {
          return pathParts[i + 1];
        }
      }
    }
  } catch (e) {
    // URL解析失败，尝试使用正则表达式
  }
  
  // 使用正则表达式匹配
  const statusMatch = tweetUrl.match(/status(?:es)?\/(\d+)/i);
  if (statusMatch && statusMatch[1]) {
    return statusMatch[1];
  }
  
  // 尝试直接匹配数字，用于处理一些特殊格式的URL
  const directMatch = tweetUrl.match(/(?:^|[^\d])(\d{10,20})(?:[^\d]|$)/);
  if (directMatch && directMatch[1]) {
    return directMatch[1];
  }
  
  return null;
}

// 检查URL是否有效
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

// 检查blob URL
function isBlobUrl(url) {
  return url && url.startsWith('blob:');
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  log('收到消息:', request.action);
  
  if (request.action === 'downloadMedia') {
    log('开始下载:', request.url);
    
    // 检查是否为有效URL
    if (!request.url || request.url === 'undefined' || request.url === 'blob:null') {
      log('无效的媒体URL:', request.url);
      sendResponse({ error: '无效的媒体URL' });
      return true;
    }
    
    // 确保URL是字符串
    if (typeof request.url !== 'string') {
      log('URL类型错误:', typeof request.url);
      sendResponse({ error: '媒体URL格式错误' });
      return true;
    }
    
    // 确保URL是有效的HTTP(S)或Blob URL
    if (!request.url.startsWith('http') && !request.url.startsWith('blob:')) {
      log('URL协议无效:', request.url.substring(0, 10) + '...');
      sendResponse({ error: 'URL协议不支持' });
      return true;
    }
    
    // 确保文件名有效
    let filename = request.filename || 'twitter_media';
    if (!filename.includes('.')) {
      // 尝试从URL中推断文件类型
      if (request.url.includes('.mp4')) {
        filename += '.mp4';
      } else if (request.url.includes('.jpg') || request.url.includes('format=jpg')) {
        filename += '.jpg';
      } else if (request.url.includes('.png') || request.url.includes('format=png')) {
        filename += '.png';
      } else {
        // 根据URL猜测类型
        if (request.url.includes('video')) {
          filename += '.mp4';
        } else {
          filename += '.jpg'; // 默认使用jpg
        }
      }
    }
    
    try {
      log(`开始下载文件: ${filename}`);
      
      // 使用chrome.downloads API下载文件
      chrome.downloads.download({
        url: request.url,
        filename: filename,
        saveAs: true
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          log('下载错误:', errorMsg);
          sendResponse({ 
            error: errorMsg || '下载过程中发生错误'
          });
        } else if (downloadId === undefined) {
          log('下载失败，没有返回downloadId');
          sendResponse({ 
            error: '下载初始化失败'
          });
        } else {
          log('下载已开始，ID:', downloadId);
          sendResponse({ 
            success: true,
            downloadId: downloadId
          });
          
          // 监听下载状态
          chrome.downloads.onChanged.addListener(function onChanged(delta) {
            if (delta.id === downloadId) {
              // 如果下载完成
              if (delta.state && delta.state.current === 'complete') {
                log(`下载完成: ${downloadId}`);
                chrome.downloads.onChanged.removeListener(onChanged);
              }
              // 如果下载失败
              else if (delta.error) {
                log(`下载失败: ${downloadId}, 错误: ${delta.error.current}`);
                chrome.downloads.onChanged.removeListener(onChanged);
              }
            }
          });
        }
      });
    } catch (error) {
      log('下载过程中发生异常:', error);
      sendResponse({ 
        error: error.message || '下载过程中发生异常'
      });
    }
    
    return true; // 保持sendResponse有效
  }
  
  // 处理视频URL获取请求
  if (request.action === 'fetchVideoUrl') {
    log('尝试获取视频URL:', request.tweetId);
    
    // 使用异步函数获取视频URL
    fetchTweetContent(request.tweetId)
      .then(videoUrl => {
        if (videoUrl) {
          log('成功获取视频URL:', videoUrl);
          
          // 向所有与这个推文ID相关的标签页广播视频URL
          if (sender && sender.tab) {
            chrome.tabs.query({}, function(tabs) {
              for (let tab of tabs) {
                if (tab.url && (tab.url.includes('twitter.com') || tab.url.includes('x.com'))) {
                  chrome.tabs.sendMessage(tab.id, {
                    action: 'videoUrlFetched',
                    tweetId: request.tweetId,
                    videoUrl: videoUrl
                  });
                }
              }
            });
          }
          
          sendResponse({ videoUrl: videoUrl });
        } else {
          log('无法获取视频URL');
          sendResponse({ error: '无法获取视频链接' });
        }
      })
      .catch(error => {
        log('获取视频URL时出错:', error);
        sendResponse({ error: '获取视频链接时出错: ' + error.message });
      });
    
    return true; // 保持sendResponse有效
  }
});

// 移除无效的阻塞式webRequest监听器
// chrome.webRequest.onBeforeRequest.addListener(
//   function(details) {
//     // 检查是否为fleets请求（收到429错误的请求）
//     if (details.url.includes('fleets/v1/fleetline')) {
//       log('阻止非必要的fleets请求:', details.url);
//       // 阻止该请求以减少429错误
//       return {cancel: true};
//     }
//     // 允许其他请求通过
//     return {cancel: false};
//   },
//   {
//     urls: ["https://x.com/i/api/fleets/*", "https://twitter.com/i/api/fleets/*"]
//   },
//   ["blocking"]
// ); 

// 监听扩展安装或更新事件
chrome.runtime.onInstalled.addListener(function(details) {
  log('扩展已安装或更新:', details.reason);
  
  // 初始化设置
  initializeSettings();
  
  // 如果是首次安装，打开欢迎页面
  if (details.reason === 'install') {
    // 打开Twitter页面
    chrome.tabs.create({
      url: 'https://x.com'
    });
  }
});

// 初始化设置
function initializeSettings() {
  // 检查是否已有设置
  chrome.storage.sync.get('settings', function(data) {
    if (!data.settings) {
      // 没有现有设置，保存默认设置
      log('未找到现有设置，初始化为默认值');
      chrome.storage.sync.set({ settings: defaultSettings });
    } else {
      // 合并现有设置与默认设置，确保所有新增设置项都有值
      log('找到现有设置，与默认值合并');
      const mergedSettings = { ...defaultSettings, ...data.settings };
      chrome.storage.sync.set({ settings: mergedSettings });
    }
  });
} 