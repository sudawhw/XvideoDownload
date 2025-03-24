// X视频下载助手 - 内容脚本

// 在文件开头添加立即执行的日志语句
console.log('[X视频下载助手] 脚本已被执行，版本: 2.1.0');

// 配置
const config = {
  // 下载按钮的SVG图标
  downloadButtonSvg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 16l4-5h-3V4h-2v7H8l4 5zm9 4v-2H3v2h18z"></path>
  </svg>`,
  // 下载按钮的类名
  downloadButtonClass: 'x-download-button',
  // 推文操作区域的选择器 - 更多备选选择器，提高健壮性
  tweetActionsSelector: '[role="group"]',
  tweetActionsSelectorAlt: 'div[role="group"][aria-label], div[role="group"]',
  // 推文元素的选择器
  tweetSelector: 'article[data-testid="tweet"], article',
  tweetSelectorAlt: 'div[data-testid^="cellInnerDiv"] article, [role="article"], article',
  // 检查DOM变化的间隔时间（毫秒）
  observerInterval: 800,
  // 按钮添加重试间隔（毫秒）
  retryInterval: 300,
  // 页面加载后的初始延迟（毫秒）
  initialDelay: 1200,
  // 调试模式
  debug: true,
  // 功能开关
  enableDownloadBtn: true, // 是否启用下载按钮
  enableHighQuality: true, // 是否尝试获取最高质量媒体
  enableBatchDownload: true, // 是否启用批量下载
  enabled: true, // 是否启用插件
  downloadInBackground: false, // 是否在后台下载
  scanInterval: 5000 // 扫描间隔时间（毫秒）
};

// 存储已处理的推文ID以避免重复添加按钮
const processedTweets = new Set();
// 存储视频URL缓存
const videoUrlCache = new Map();
// 跟踪按钮添加尝试次数
const buttonAttempts = new Map();
// 标记页面是否已完全加载
let pageFullyLoaded = false;
// 存储MutationObserver实例
let mainObserver = null;
// 存储媒体检测结果缓存
const mediaDetectionCache = new Map();

// 标记扩展已初始化
let extensionInitialized = false;

// 日志函数
function log(...args) {
  if (config.debug) {
    console.log('[X视频下载助手]', ...args);
  }
}

// 处理HTML页面中的所有推文
function scanTweets() {
  try {
    // 快速退出条件检查：如果插件被禁用或在通知页面，直接返回
    if (!config.enabled) {
      log('插件已禁用，不扫描推文');
      removeAllDownloadButtons();
      return;
    }
    
    // 通知页面不处理
    if (window.location.pathname.includes('/notifications')) {
      log('当前在通知页面，不添加下载按钮');
      removeAllDownloadButtons();
      return;
    }
    
    log('开始扫描页面中的推文...');
    
    // 优化选择器使用：将所有选择器合并到一个查询中，减少DOM查询次数
    const combinedSelector = [
      config.tweetSelector,
      config.tweetSelectorAlt,
      'article', 
      '[role="article"]',
      '[data-testid="tweet"]'
    ].join(', ');
    
    // 执行单次查询
    const tweets = document.querySelectorAll(combinedSelector);
    
    log(`总共找到 ${tweets.length} 条推文`);
    
    // 是否为单推文详情页 - 提前计算一次
    const isSingleTweetPage = window.location.pathname.includes('/status/');
    
    // 如果找到了推文，可以记录第一个推文的信息用于调试
    if (tweets.length > 0 && config.debug) {
      const firstTweet = tweets[0];
      log('第一个推文结构:', firstTweet.outerHTML.substring(0, 200) + '...');
      
      // 检查操作栏
      const actionGroups = firstTweet.querySelectorAll('[role="group"]');
      log(`第一个推文中找到 ${actionGroups.length} 个操作栏`);
    }
    
    let processedCount = 0;
    
    // 处理每条推文 - 使用较新的 forEach 而不是 for 循环
    tweets.forEach(tweet => {
      if (processTweet(tweet, isSingleTweetPage)) {
        processedCount++;
      }
    });
    
    log(`本次扫描处理了 ${processedCount} 条推文`);
    
    // 只有在常规方法完全未处理任何推文时，才尝试备用方法
    if (processedCount === 0 && tweets.length > 0) {
      log('常规方法未处理到任何推文，尝试备用元素选择方法');
      tryAlternativeElementSelection();
    }
  } catch (error) {
    log('扫描推文时出错:', error);
    console.error('扫描推文时出错:', error);
  }
}

// 移除所有下载按钮
function removeAllDownloadButtons() {
  try {
    // 移除所有下载按钮和容器
    document.querySelectorAll('.x-download-button-container').forEach(container => {
      container.remove();
    });
    
    // 同时移除所有工具提示
    document.querySelectorAll('.x-tooltip').forEach(tooltip => {
      tooltip.remove();
    });
    
    log('已移除所有下载按钮');
  } catch (error) {
    log('移除下载按钮时出错:', error);
  }
}

// 初始化函数
function init() {
  try {
    log('开始初始化...');
    log('页面URL: ' + window.location.href);
    
    // 立即设置消息监听器
    setupMessageListener();
    
    // 使用Promise处理设置加载，统一异步流程
    loadSettings().then(settings => {
      // 设置URL变化监视器
      setupURLChangeMonitor();
      
      // 设置滚动监听器（使用节流函数）
      setupScrollListener();
      
      // 基于条件执行初始扫描
      if (settings.enabled && !window.location.pathname.includes('/notifications')) {
        log('开始初始扫描页面');
        
        // 首次扫描
        scanTweets();
        
        // 使用递减延迟多次扫描，减少总扫描次数但提高成功率
        const scanDelays = [1000, 3000, 6000]; // 1秒, 3秒, 6秒后扫描
        scanDelays.forEach(delay => {
          setTimeout(scanTweets, delay);
        });
      } else if (window.location.pathname.includes('/notifications')) {
        log('当前在通知页面，不执行初始扫描');
      } else {
        log('插件已禁用，不执行初始扫描');
      }
      
      // 设置定期扫描 - 使用较长间隔减少性能影响
      setInterval(function() {
        if (settings.enabled && !window.location.pathname.includes('/notifications')) {
          scanTweets();
        }
      }, 5000); // 每5秒扫描一次，减少资源占用
      
      // 添加右键菜单支持和快捷键
      addVideoDownloadShortcut();
      
      log('初始化完成');
      
      // 标记初始化完成
      extensionInitialized = true;
      
      // 在全局暴露刷新函数，方便调试
      window.refreshDownloadButtons = refreshDownloadButtons;
    });
  } catch (error) {
    log('初始化时出错:', error);
  }
}

// 添加新的设置加载函数，使用Promise包装
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['enabled', 'enableHighQuality', 'downloadInBackground', 'settings'], function(items) {
      if (chrome.runtime.lastError) {
        log('获取设置时出错:', chrome.runtime.lastError);
        // 出错时使用默认配置
        resolve(config);
        return;
      }
      
      // 检查是否存在旧版设置格式
      if (items.settings) {
        log('检测到旧版设置格式:', items.settings);
        // 从旧版设置中提取配置
        if (items.settings.enableDownloadBtn !== undefined) {
          config.enabled = items.settings.enableDownloadBtn;
        }
        
        if (items.settings.enableHighQuality !== undefined) {
          config.enableHighQuality = items.settings.enableHighQuality;
        }
        
        if (items.settings.enableBatchDownload !== undefined) {
          config.enableBatchDownload = items.settings.enableBatchDownload;
        }
      }
      
      // 优先使用新版设置格式覆盖
      config.enabled = items.enabled !== undefined ? items.enabled : config.enabled;
      config.enableHighQuality = items.enableHighQuality !== undefined ? items.enableHighQuality : config.enableHighQuality;
      config.downloadInBackground = items.downloadInBackground !== undefined ? items.downloadInBackground : config.downloadInBackground;
      
      log(`设置加载完成 - 启用状态: ${config.enabled}, 高质量: ${config.enableHighQuality}, 批量下载: ${config.enableBatchDownload}, 后台下载: ${config.downloadInBackground}`);
      
      resolve(config);
    });
  });
}

// 设置URL变化监视器
function setupURLChangeMonitor() {
  try {
    log('设置URL变化监视器');
    
    // 保存当前URL用于比较
    let lastUrl = window.location.href;
    
    // 创建URL变化监视器
    const urlObserver = new MutationObserver(() => {
      // 检查URL是否变化
      if (lastUrl !== window.location.href) {
        log(`URL变化: ${lastUrl} -> ${window.location.href}`);
        
        // 更新保存的URL
        lastUrl = window.location.href;
        
        // 检查当前页面是否为通知页面
        const isNotificationsPage = window.location.pathname.includes('/notifications');
        
        if (isNotificationsPage) {
          log('导航到通知页面，移除所有下载按钮');
          removeAllDownloadButtons();
        } else {
          // 当URL变化时，重置推文处理状态并重新扫描
          log('URL变化，重置状态并重新扫描推文');
          
          // 清空媒体检测缓存，以便重新查找媒体
          mediaDetectionCache.clear();
          
          // 重新扫描
          setTimeout(scanTweets, 500);
        }
      }
    });
    
    // 监听document标题变化作为导航的指示器
    urlObserver.observe(document.querySelector('title'), { 
      subtree: true, 
      characterData: true, 
      childList: true 
    });
    
    log('URL变化监视器已设置');
  } catch (error) {
    log('设置URL变化监视器时出错:', error);
  }
}

// 设置滚动监听器
function setupScrollListener() {
  try {
    log('设置滚动监听器');
    
    // 创建节流函数，限制扫描频率
    const throttledScan = throttle(scanTweets, 800);
    
    // 处理滚动事件
    const handleScroll = () => {
      // 快速退出条件检查
      if (!config.enabled) return;
      
      // 触发节流后的扫描
      throttledScan();
    };
    
    // 添加滚动事件监听
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    log('滚动监听器已设置');
  } catch (error) {
    log('设置滚动监听器时出错:', error);
  }
}

// 添加节流函数
function throttle(func, delay) {
  let lastCall = 0;
  return function() {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func.apply(this, arguments);
    }
  };
}

// 处理单个推文元素
function processTweet(tweet, isDetailPage = null) {
  try {
    if (!tweet || !tweet.isConnected) {
      return false;
    }
    
    // 忽略已处理过的推文
    if (tweet.hasAttribute('data-x-processed')) {
      return true;
    }
    
    // 标记推文为已处理
    tweet.setAttribute('data-x-processed', 'true');
    
    // 获取推文ID
    const tweetId = extractTweetId(tweet);
    if (!tweetId) {
      log('跳过没有ID的推文');
      return false;
    }
    
    log(`处理推文 ID: ${tweetId}`);
    
    // 查找媒体元素
    const mediaElements = findMediaElements(tweet, tweetId);
    
    // 如果找到媒体元素，添加下载按钮
    if (mediaElements && mediaElements.length > 0) {
      log(`推文 ${tweetId} 找到 ${mediaElements.length} 个媒体元素，添加下载按钮`);
      addDownloadButton(tweet, mediaElements);
      return true;
    } else {
      // 检查推文是否可能含有媒体但未被检测到
      // 在某些情况下，我们可能无法立即检测到媒体，但后续可能加载
      const hasPotentialMedia = 
        tweet.querySelector('img') !== null || 
        tweet.querySelector('video') !== null ||
        tweet.querySelector('[role="img"]') !== null ||
        tweet.querySelector('[data-testid="tweetPhoto"]') !== null ||
        tweet.querySelector('[data-testid="videoComponent"]') !== null;
      
      if (hasPotentialMedia || isDetailPage) {
        log(`推文 ${tweetId} 可能含有媒体或是详情页，仍添加下载按钮`);
        // 即使没有立即检测到媒体，也添加下载按钮，因为页面可能动态加载内容
        addDownloadButton(tweet, []);
        return true;
      } else {
        log(`推文 ${tweetId} 没有找到媒体元素，不添加下载按钮`);
        return false;
      }
    }
  } catch (error) {
    log('处理推文时出错:', error);
    console.error('处理推文时出错:', error);
    return false;
  }
}

// 尝试备用元素选择方法
function tryAlternativeElementSelection() {
  // 尝试多种可能的选择器
  const possibleTweetContainers = [
    // 主列
    'div[data-testid="primaryColumn"] div[data-testid^="cellInnerDiv"]',
    // 详情页的主推文
    'div[data-testid="primaryColumn"] > div > div > div > div:nth-child(2) > div',
    // 通用文章容器
    'div[aria-label][role="region"] article',
    // 最后尝试任何具有role=article的元素
    '[role="article"]'
  ];
  
  for (const selector of possibleTweetContainers) {
    const containers = document.querySelectorAll(selector);
    log(`备用选择器 "${selector}" 找到 ${containers.length} 个元素`);
    
    containers.forEach(container => {
      // 查找可能的操作栏
      const actionBars = container.querySelectorAll('[role="group"]');
      
      actionBars.forEach(actionBar => {
        // 确保这个操作栏没有下载按钮
        if (!actionBar.querySelector(`.${config.downloadButtonClass}`)) {
          // 尝试找到包含这个操作栏的推文元素
          let tweetElement = actionBar.closest('article');
          if (!tweetElement) {
            tweetElement = actionBar.closest('[role="article"]');
          }
          
          if (tweetElement) {
            const tweetId = extractTweetId(tweetElement);
            if (tweetId) {
              // 首先检查推文是否包含可下载的媒体内容
              const mediaElements = findMediaElements(tweetElement, tweetId);
              
              // 只有在找到媒体内容时才添加下载按钮
              if (mediaElements && mediaElements.length > 0) {
                log(`备用方法：添加按钮到推文 ${tweetId}`);
                addDownloadButton(tweetElement, mediaElements);
                processedTweets.add(tweetId);
              } else {
                // 没有找到媒体内容，将推文标记为已处理
                log(`备用方法：推文 ${tweetId} 没有媒体内容，不添加下载按钮`);
                processedTweets.add(tweetId);
              }
            }
          }
        }
      });
    });
  }
}

// 监听网络请求以捕获视频URL
function listenForVideoRequests() {
  if (window.XMLHttpRequest) {
    // 保存原始方法
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    // 重写open方法以监听请求
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      // 保存URL以便在响应中使用
      this._url = url;
      
      // 调用原始方法
      return originalOpen.apply(this, arguments);
    };
    
    // 重写send方法以监听响应
    XMLHttpRequest.prototype.send = function(body) {
      // 添加响应监听器
      this.addEventListener('load', function() {
        try {
          // 检查URL是否包含视频相关的路径
          if (this._url && 
             (this._url.includes('video/') || 
              this._url.includes('media/') || 
              this._url.includes('mp4'))) {
            
            // 尝试解析响应为JSON
            const data = JSON.parse(this.responseText);
            
            // 查找视频URL
            if (data && data.track && data.track.contentId) {
              const tweetId = data.track.contentId;
              
              // 查找视频变体
              if (data.track && data.track.playbackUrl) {
                log(`发现视频URL: ${data.track.playbackUrl} 对应推文ID: ${tweetId}`);
                videoUrlCache.set(tweetId, data.track.playbackUrl);
              }
            }
            
            // 查找多个视频变体
            if (data && data.variants && Array.isArray(data.variants)) {
              // 找出最高分辨率的MP4
              const mp4Variants = data.variants.filter(v => v.content_type === 'video/mp4');
              if (mp4Variants.length > 0) {
                // 按比特率排序，选择最高的
                mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                const bestVariant = mp4Variants[0];
                
                // 从URL中提取推文ID
                const urlMatch = this._url.match(/status\/(\d+)/);
                const tweetId = urlMatch ? urlMatch[1] : null;
                
                if (tweetId && bestVariant.url) {
                  log(`发现高质量视频URL: ${bestVariant.url} 对应推文ID: ${tweetId}`);
                  videoUrlCache.set(tweetId, bestVariant.url);
                }
              }
            }
          }
        } catch (e) {
          // 解析错误，忽略即可
        }
      });
      
      // 调用原始方法
      return originalSend.apply(this, arguments);
    };
    
    log('已设置网络请求监听器');
  }
}

// 从推文元素中提取推文ID
function extractTweetId(tweet) {
  try {
    if (!tweet) return null;
    
    // 检查是否已经有data-tweet-id属性
    let tweetId = tweet.getAttribute('data-tweet-id');
    if (tweetId) {
      return tweetId;
    }
    
    // 尝试从文章属性中获取
    tweetId = tweet.dataset.articleId;
    if (tweetId) {
      return tweetId;
    }
    
    // 尝试从时间元素获取
    let timeElement = tweet.querySelector('time');
    if (timeElement) {
      const parentWithLink = timeElement.closest('a');
      if (parentWithLink && parentWithLink.href) {
        // 解析链接中的推文ID
        const match = parentWithLink.href.match(/\/status\/(\d+)/);
        if (match && match[1]) {
          tweetId = match[1];
          // 缓存结果，避免未来重复提取
          tweet.setAttribute('data-tweet-id', tweetId);
          return tweetId;
        }
      }
    }
    
    // 尝试从任何带有推文链接的元素获取
    const linkWithStatus = tweet.querySelector('a[href*="/status/"]');
    if (linkWithStatus) {
      const match = linkWithStatus.href.match(/\/status\/(\d+)/);
      if (match && match[1]) {
        tweetId = match[1];
        tweet.setAttribute('data-tweet-id', tweetId);
        return tweetId;
      }
    }
    
    // 尝试从URL中获取（主要用于单推文页面）
    if (window.location.pathname.includes('/status/')) {
      const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
      if (urlMatch && urlMatch[1]) {
        tweetId = urlMatch[1];
        tweet.setAttribute('data-tweet-id', tweetId);
        return tweetId;
      }
    }
    
    // 如果所有尝试都失败
    log('无法从推文元素提取ID');
    return null;
  } catch (error) {
    log('提取推文ID时出错:', error);
    return null;
  }
}

// 在推文添加下载按钮
function addDownloadButton(tweet, media) {
  try {
    // 快速检查，避免重复添加
    if (tweet.querySelector('.x-download-button')) {
      return;
    }
    
    log('开始添加下载按钮');
    
    // 构建有效的媒体数据 - 提前验证媒体数据以减少后续处理
    let validMedia = [];
    
    if (Array.isArray(media)) {
      validMedia = media.filter(item => {
        return item && 
               typeof item === 'object' && 
               item.type && 
               (item.url || (item.type === 'video' && item.needsExtraction));
      });
    } else if (media && typeof media === 'object') {
      if (media.type && (media.url || (media.type === 'video' && media.needsExtraction))) {
        validMedia.push(media);
      }
    }
    
    // 进一步验证URL
    validMedia = validMedia.filter(item => {
      if (item.type === 'video' && item.needsExtraction) return true;
      return item.url && typeof item.url === 'string' && 
            (item.url.startsWith('http') || item.url.startsWith('blob:'));
    });
    
    // 查找操作按钮区域 - 使用单一查询减少DOM操作
    const actionBarSelector = '[role="group"], div[role="group"], .css-1dbjc4n[role="group"], .r-18u37iz[role="group"]';
    let actionBar = tweet.querySelector(actionBarSelector);
    
    if (!actionBar) {
      // 创建新的操作栏
      const tweetContent = tweet.querySelector('div[lang]') || tweet;
      actionBar = document.createElement('div');
      actionBar.setAttribute('role', 'group');
      actionBar.style.cssText = 'display:flex;align-items:center;margin-top:12px';
      
      if (tweetContent && tweetContent.parentNode) {
        tweetContent.parentNode.appendChild(actionBar);
      } else {
        tweet.appendChild(actionBar);
      }
    }
    
    if (!actionBar || !actionBar.isConnected) {
      log('操作栏不可用，无法添加下载按钮');
      return;
    }
    
    // 创建按钮元素
    const downloadButtonContainer = document.createElement('div');
    downloadButtonContainer.className = 'x-download-button-container';
    downloadButtonContainer.style.cssText = 'display:flex;margin-left:8px';
    
    const downloadButton = document.createElement('div');
    downloadButton.className = 'x-download-button';
    downloadButton.textContent = '下载';
    downloadButton.role = 'button';
    downloadButton.tabIndex = 0;
    downloadButton.setAttribute('data-testid', 'x-download');
    
    // 使用cssText合并多个样式设置，减少重排
    downloadButton.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:4px 8px;' +
                                  'border-radius:4px;cursor:pointer;background-color:rgb(239,243,244);' +
                                  'color:rgb(15,20,25);font-size:13px;font-weight:600';
    
    // 存储媒体信息
    if (validMedia.length > 0) {
      downloadButton.setAttribute('data-has-media', 'true');
      
      // 创建序列化数据
      const serializableMedia = validMedia.map(item => {
        const result = { type: item.type, tweetId: item.tweetId || null };
        if (item.url) result.url = item.url;
        if (item.needsExtraction) result.needsExtraction = true;
        if (item.isBlob) result.isBlob = true;
        return result;
      });
      
      // 序列化数据 - 使用try-catch增强健壮性
      try {
        downloadButton.setAttribute('data-media-json', JSON.stringify(serializableMedia));
      } catch (e) {
        log(`媒体数据序列化失败: ${e.message}`);
        downloadButton.setAttribute('data-media-json', '[]');
      }
    } else {
      downloadButton.setAttribute('data-has-media', 'false');
      downloadButton.setAttribute('data-media-json', '[]');
    }
    
    // 添加按钮点击事件处理
    downloadButton.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      
      // 解析媒体数据
      let mediaElements = [];
      try {
        const mediaData = this.getAttribute('data-media-json');
        if (mediaData) {
          mediaElements = JSON.parse(mediaData);
        }
      } catch (e) {
        log('解析媒体数据出错:', e);
      }
      
      // 如果启用了配置，直接显示媒体选择对话框来进行调试
      const debugShowDialog = false; // 设置为true可强制显示选择对话框，用于调试
      
      // 处理媒体下载
      if ((!mediaElements || mediaElements.length === 0) && !debugShowDialog) {
        alert('此推文没有可下载的资源');
        return;
      }
      
      log(`检测到 ${mediaElements.length} 个媒体元素，准备处理下载`);
      
      // 下载逻辑 - 修改为总是对多个元素显示选择对话框
      if (mediaElements.length > 1 || debugShowDialog) {
        log('多个媒体元素，显示选择对话框');
        // 确保批量下载功能启用
        config.enableBatchDownload = true;
        showMediaSelectionDialog(mediaElements);
      } else {
        log('单个媒体元素，直接下载');
        downloadMedia(mediaElements[0]);
      }
    });
    
    // 添加按钮到DOM
    downloadButtonContainer.appendChild(downloadButton);
    actionBar.appendChild(downloadButtonContainer);
    
    // 创建工具提示
    const tooltip = document.createElement('div');
    tooltip.className = 'x-tooltip';
    tooltip.textContent = '下载';
    tooltip.style.cssText = 'display:none;position:fixed;background-color:rgba(15,20,25,0.8);' +
                           'color:white;padding:2px 8px;border-radius:2px;z-index:9999';
    document.body.appendChild(tooltip);
    
    // 鼠标悬停显示工具提示
    downloadButton.addEventListener('mouseenter', function(event) {
      const rect = this.getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      tooltip.style.top = (rect.top - 30) + 'px';
      tooltip.style.display = 'block';
    });
    
    // 鼠标离开隐藏工具提示
    downloadButton.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
    });
    
    // 使用MutationObserver监听按钮移除
    const buttonObserver = new MutationObserver(function(mutations) {
      if (!document.body.contains(downloadButton)) {
        if (tooltip && tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
        buttonObserver.disconnect();
      }
    });
    
    // 监听父元素变化
    if (downloadButton.parentNode) {
      buttonObserver.observe(downloadButton.parentNode, { childList: true });
      if (tweet.parentNode) {
        buttonObserver.observe(tweet.parentNode, { childList: true });
      }
    }
    
    log('下载按钮添加成功');
  } catch (error) {
    log('添加下载按钮时出错:', error);
  }
}

// 处理下载逻辑
function handleDownload(tweet, tweetId) {
  // 查找推文中的媒体元素
  const mediaElements = findMediaElements(tweet, tweetId);
  
  if (mediaElements.length === 0) {
    alert('未找到可下载的媒体内容');
    return;
  }
  
  // 检查是否有视频元素
  const videoElements = mediaElements.filter(media => media.type === 'video');
  
  // 如果同时有视频和其他媒体元素，优先下载视频
  if (videoElements.length > 0) {
    log('找到视频元素，优先下载视频');
    
    // 如果只有一个视频元素，直接下载
    if (videoElements.length === 1) {
      downloadMedia(videoElements[0]);
      return;
    }
    
    // 如果有多个视频元素，显示选择界面
    showMediaSelectionDialog(videoElements);
    return;
  }
  
  // 如果有多个非视频媒体元素，显示选择界面
  if (mediaElements.length > 1) {
    showMediaSelectionDialog(mediaElements);
  } else {
    // 只有一个媒体元素，直接下载
    downloadMedia(mediaElements[0]);
  }
}

// 显示媒体选择界面 - 增强版
function showMediaSelectionDialog(mediaElements) {
  try {
    log('显示媒体选择对话框...');
    
    // 确保有媒体元素
    if (!mediaElements || !Array.isArray(mediaElements) || mediaElements.length === 0) {
      log('没有媒体元素可以显示');
      alert('未找到可下载的媒体内容');
      return;
    }
    
    // 如果批量下载功能被禁用且有多个媒体，直接下载第一个
    if (!config.enableBatchDownload && mediaElements.length > 1) {
      log('批量下载功能已禁用，直接下载第一个元素');
      downloadMedia(mediaElements[0]);
      return;
    }
    
    // 记录对话框状态
    log(`准备显示选择对话框，共有 ${mediaElements.length} 个媒体元素`);
    
    // 创建对话框容器
    const dialog = document.createElement('div');
    dialog.className = 'x-media-selection-dialog';
    dialog.innerHTML = `
      <div class="x-dialog-content">
        <h3>请选择要下载的媒体</h3>
        
        <div class="x-dialog-actions">
          <button class="x-select-all" id="x-select-all">全选</button>
          <span>${mediaElements.length} 个媒体项目</span>
        </div>
        
        <div class="x-media-list"></div>
        
        <div class="x-indeterminate-progress">
          <div class="x-progress-track"></div>
        </div>
        
        <div class="x-dialog-footer">
          <button class="x-dialog-close">取消</button>
          <button class="x-download-selected" id="x-download-selected" disabled>下载所选项目 (0)</button>
        </div>
      </div>
    `;
    
    // 添加到页面
    document.body.appendChild(dialog);
    
    // 媒体项目容器
    const mediaList = dialog.querySelector('.x-media-list');
    
    // 进度条元素
    const progressElement = dialog.querySelector('.x-indeterminate-progress');
    
    // 存储选中项目的数组
    const selectedItems = [];
    
    // 更新下载按钮状态
    function updateDownloadButton() {
      const downloadBtn = dialog.querySelector('#x-download-selected');
      downloadBtn.textContent = `下载所选项目 (${selectedItems.length})`;
      downloadBtn.disabled = selectedItems.length === 0;
    }
    
    // 全选/取消全选功能
    const selectAllBtn = dialog.querySelector('#x-select-all');
    let allSelected = false;
    
    selectAllBtn.addEventListener('click', () => {
      log('点击全选/取消全选按钮');
      allSelected = !allSelected;
      
      // 更新所有项目的选中状态
      const mediaItems = dialog.querySelectorAll('.x-media-item');
      mediaItems.forEach((item, index) => {
        if (allSelected) {
          item.classList.add('selected');
          if (!selectedItems.includes(index)) {
            selectedItems.push(index);
          }
        } else {
          item.classList.remove('selected');
          const itemIndex = selectedItems.indexOf(index);
          if (itemIndex !== -1) {
            selectedItems.splice(itemIndex, 1);
          }
        }
      });
      
      // 更新全选按钮样式
      if (allSelected) {
        selectAllBtn.classList.add('selected');
        selectAllBtn.textContent = '取消全选';
      } else {
        selectAllBtn.classList.remove('selected');
        selectAllBtn.textContent = '全选';
      }
      
      // 更新下载按钮状态
      updateDownloadButton();
    });
    
    // 添加默认空图片URL，用于显示加载失败的图片
    const defaultImageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"%3E%3Cpath fill="%23ccc" d="M21.9 21.9l-8.49-8.49-9.82-9.82L2.1 2.1.69 3.51 3 5.83V19c0 1.1.9 2 2 2h13.17l2.31 2.31 1.42-1.41zM5 18l3.5-4.5 2.5 3.01L12.17 15l3 3H5zm16 .17L5.83 3H19c1.1 0 2 .9 2 2v13.17z"/%3E%3C/svg%3E';
    
    // 添加媒体项目
    mediaElements.forEach((media, index) => {
      try {
        // 获取媒体类型的显示名称
        const mediaTypeName = media.type === 'image' ? '图片' : '视频';
        
        // 创建媒体项目容器
        const mediaItem = document.createElement('div');
        mediaItem.className = 'x-media-item';
        
        // 准备媒体URL，如果没有则使用默认图片
        const mediaUrl = media.url || '';
        const displayUrl = mediaUrl || defaultImageUrl;
        
        // 根据媒体类型创建预览
        if (media.type === 'image') {
          mediaItem.innerHTML = `
            <div class="x-checkbox"></div>
            <img src="${displayUrl}" alt="图片 ${index + 1}" onerror="this.src='${defaultImageUrl}'">
            <div class="x-media-info">
              <span>${index + 1}</span>
              <span class="x-media-type">${mediaTypeName}</span>
            </div>
          `;
        } else if (media.type === 'video') {
          // 对于没有URL的视频，显示加载中状态
          if (!media.url || media.needsExtraction) {
            mediaItem.innerHTML = `
              <div class="x-checkbox"></div>
              <div style="background-color:#202830;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                <div style="width:24px;height:24px;border:3px solid rgba(29,161,242,0.2);border-top-color:#1DA1F2;border-radius:50%;animation:x-spin 1s linear infinite;"></div>
              </div>
              <div class="x-media-info">
                <span>${index + 1}</span>
                <span class="x-media-type">${mediaTypeName}</span>
              </div>
            `;
          } else {
            mediaItem.innerHTML = `
              <div class="x-checkbox"></div>
              <video src="${displayUrl}" preload="metadata"></video>
              <div class="x-media-info">
                <span>${index + 1}</span>
                <span class="x-media-type">${mediaTypeName}</span>
              </div>
            `;
            
            // 尝试加载视频预览帧
            const video = mediaItem.querySelector('video');
            if (video) {
              video.addEventListener('loadedmetadata', () => {
                // 设置视频到中点位置以获取更好的预览
                if (video.duration && isFinite(video.duration)) {
                  video.currentTime = video.duration / 2;
                }
              });
              
              // 添加错误处理
              video.addEventListener('error', () => {
                video.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.style.cssText = 'background-color:#202830;width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
                placeholder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="#ccc"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
                video.parentNode.insertBefore(placeholder, video);
              });
            }
          }
        }
        
        // 添加选择事件
        mediaItem.addEventListener('click', () => {
          log(`点击了第 ${index + 1} 个媒体项目`);
          // 切换选中状态
          mediaItem.classList.toggle('selected');
          
          // 更新选中项目数组
          if (mediaItem.classList.contains('selected')) {
            if (!selectedItems.includes(index)) {
              selectedItems.push(index);
            }
          } else {
            const itemIndex = selectedItems.indexOf(index);
            if (itemIndex !== -1) {
              selectedItems.splice(itemIndex, 1);
            }
          }
          
          // 更新全选按钮状态
          if (selectedItems.length === mediaElements.length) {
            selectAllBtn.classList.add('selected');
            selectAllBtn.textContent = '取消全选';
            allSelected = true;
          } else {
            selectAllBtn.classList.remove('selected');
            selectAllBtn.textContent = '全选';
            allSelected = false;
          }
          
          // 更新下载按钮状态
          updateDownloadButton();
        });
        
        // 将媒体项添加到列表
        mediaList.appendChild(mediaItem);
      } catch (error) {
        log(`创建媒体项 ${index} 时出错:`, error);
      }
    });
    
    // 添加下载所选按钮事件
    const downloadSelectedBtn = dialog.querySelector('#x-download-selected');
    downloadSelectedBtn.addEventListener('click', () => {
      // 检查是否有选中项目
      if (selectedItems.length === 0) {
        return;
      }
      
      log(`下载所选媒体，选中了 ${selectedItems.length} 个项目`);
      
      // 隐藏对话框
      document.body.removeChild(dialog);
      
      // 下载选中的媒体项目
      selectedItems.sort((a, b) => a - b); // 确保按原始顺序下载
      
      // 批量下载所选媒体
      batchDownloadMedia(selectedItems.map(index => mediaElements[index]));
    });
    
    // 添加关闭按钮事件
    const closeBtn = dialog.querySelector('.x-dialog-close');
    closeBtn.addEventListener('click', () => {
      log('关闭媒体选择对话框');
      document.body.removeChild(dialog);
    });
    
    // 添加点击外部关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        log('点击对话框外部，关闭对话框');
        document.body.removeChild(dialog);
      }
    });
    
    // 添加ESC键关闭对话框
    function handleEscKey(event) {
      if (event.key === 'Escape') {
        if (document.body.contains(dialog)) {
          log('按ESC键关闭对话框');
          document.body.removeChild(dialog);
          document.removeEventListener('keydown', handleEscKey);
        }
      }
    }
    
    document.addEventListener('keydown', handleEscKey);
    
    log('媒体选择对话框显示成功');
  } catch (error) {
    log('显示媒体选择对话框时出错:', error);
    console.error('显示媒体选择对话框时出错:', error);
  }
}

// 批量下载媒体文件
function batchDownloadMedia(mediaItems) {
  if (!mediaItems || mediaItems.length === 0) return;
  
  // 检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    showExtensionContextError();
    return;
  }
  
  // 显示下载进度指示器
  showDownloadProgress(mediaItems);
  
  // 创建下载队列
  const downloadQueue = [...mediaItems];
  
  // 开始下载第一个项目
  processDownloadQueue(downloadQueue);
}

// 处理下载队列 - 添加错误处理
function processDownloadQueue(queue, currentIndex = 0) {
  if (currentIndex >= queue.length) {
    // 所有项目下载完成，隐藏进度指示器
    hideDownloadProgress();
    return;
  }
  
  // 检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    hideDownloadProgress();
    showExtensionContextError();
    return;
  }
  
  // 获取当前项目
  const media = queue[currentIndex];
  
  // 更新进度指示器
  updateDownloadProgress(currentIndex + 1, queue.length);
  
  // 快速下载模式 - 不等待获取视频链接
  quickDownloadMedia(media).then(() => {
    // 下载完成，处理下一个
    setTimeout(() => {
      processDownloadQueue(queue, currentIndex + 1);
    }, 500); // 添加短暂延迟，避免浏览器限制并发下载
  }).catch(error => {
    // 下载出错，但仍继续下一个
    log('批量下载出错:', error);
    setTimeout(() => {
      processDownloadQueue(queue, currentIndex + 1);
    }, 500);
  });
}

// 快速下载媒体文件 - 增加错误处理
function quickDownloadMedia(media) {
  return new Promise((resolve, reject) => {
    if (!media || !media.url) {
      reject(new Error('无效的媒体URL'));
      return;
    }
    
    // 检查扩展上下文是否有效
    if (!isExtensionContextValid()) {
      reject(new Error('Extension context invalidated'));
      return;
    }
    
    log('快速下载媒体: ' + media.type + ', URL: ' + media.url);
    
    // 如果是blob URL的视频，并且我们有推文ID
    if (media.type === 'video' && media.isBlob && media.tweetId) {
      // 立即向background.js发送获取真实视频URL的请求
      safeRuntimeSendMessage({
        action: 'fetchVideoUrl',
        tweetId: media.tweetId
      });
      
      // 不等待视频URL获取完成，显示下载对话框
      directDownloadVideo(media.tweetId, true);
      
      // 视为成功处理
      resolve();
      return;
    }
    
    // 正常处理图片和非blob视频
    // 从URL提取文件名
    let filename = media.url.split('/').pop();
    if (filename.includes('?')) {
      filename = filename.split('?')[0];
    }
    
    // 添加文件扩展名（如果没有）
    if (media.type === 'video' && !filename.match(/\.(mp4|mov|webm|avi)$/i)) {
      filename += '.mp4';
    } else if (media.type === 'image' && !filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      // 尝试从URL中获取格式
      if (media.url.includes('format=')) {
        const format = new URLSearchParams(media.url.split('?')[1]).get('format');
        if (format) {
          filename += '.' + format;
        } else {
          filename += '.jpg';
        }
      } else {
        filename += '.jpg';
      }
    }
    
    // 使用Chrome下载API下载文件
    safeRuntimeSendMessage({
      action: 'downloadMedia',
      url: media.url,
      filename: filename
    }, function(response) {
      if (chrome.runtime.lastError) {
        log('下载时出错:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (response && response.error) {
        log('下载失败:', response.error);
        reject(new Error(response.error));
      } else if (response && response.success) {
        log('下载已开始:', response.downloadId);
        resolve();
      } else {
        reject(new Error('未知错误'));
      }
    });
  });
}

// 添加视频下载快捷键
function addVideoDownloadShortcut() {
  // 为页面添加键盘快捷键
  document.addEventListener('keydown', function(e) {
    // 检测Ctrl+Shift+D组合键
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      // 查找当前窗口中正在播放的视频
      const videos = document.querySelectorAll('video');
      let activeVideo = null;
      
      for (const video of videos) {
        // 检查视频是否可见且正在播放
        const rect = video.getBoundingClientRect();
        const isVisible = (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth
        );
        
        if (isVisible && !video.paused) {
          activeVideo = video;
          break;
        }
      }
      
      if (activeVideo) {
        const tweet = activeVideo.closest('article');
        if (tweet) {
          const tweetId = extractTweetId(tweet);
          log('通过快捷键尝试下载视频，推文ID:', tweetId);
          
          // 查找媒体元素
          const mediaElements = findMediaElements(tweet, tweetId);
          
          // 过滤出视频元素
          const videoElements = mediaElements.filter(media => media.type === 'video');
          
          if (videoElements.length > 0) {
            // 尝试下载第一个视频
            downloadMedia(videoElements[0]);
          } else {
            alert('未找到可下载的视频');
          }
        }
      } else {
        alert('未找到正在播放的视频');
      }
    }
  });
}

// 显示下载进度指示器
function showDownloadProgress(mediaItems) {
  // 如果已存在，先移除
  hideDownloadProgress();
  
  const indicator = document.createElement('div');
  indicator.className = 'x-downloading-indicator';
  indicator.innerHTML = `
    <div class="x-indicator-content">
      <div class="x-loading"></div>
      <span>正在下载媒体 (1/${mediaItems.length})</span>
      <div class="x-progress-bar">
        <div class="x-progress-fill" style="width: ${Math.floor(1 / mediaItems.length * 100)}%"></div>
      </div>
    </div>
  `;
  
  document.body.appendChild(indicator);
}

// 隐藏下载进度指示器
function hideDownloadProgress() {
  const indicator = document.querySelector('.x-downloading-indicator');
  if (indicator) {
    document.body.removeChild(indicator);
  }
}

// 更新下载进度
function updateDownloadProgress(current, total) {
  const indicator = document.querySelector('.x-downloading-indicator');
  if (!indicator) return;
  
  const statusText = indicator.querySelector('span');
  const progressFill = indicator.querySelector('.x-progress-fill');
  
  statusText.textContent = `正在下载媒体 (${current}/${total})`;
  progressFill.style.width = `${Math.floor(current / total * 100)}%`;
}

// 查找推文中的媒体元素
function findMediaElements(tweet, tweetId) {
  const mediaElements = [];
  
  try {
    // 如果没有提供有效的 tweetId，无法继续处理
    if (!tweetId) {
      return mediaElements;
    }
    
    log(`查找推文媒体元素，推文ID: ${tweetId}`);
    
    // 检查缓存 - 提前进行缓存检查可以快速返回结果
    const now = Date.now();
    if (mediaDetectionCache.has(tweetId)) {
      const cachedData = mediaDetectionCache.get(tweetId);
      // 检查缓存是否有效（1分钟内）
      if (cachedData.timestamp && now - cachedData.timestamp < 60000) {
        log(`使用缓存的媒体检测结果，推文ID: ${tweetId}`);
        return cachedData.elements;
      } else {
        // 缓存已过期，删除
        mediaDetectionCache.delete(tweetId);
      }
    }
    
    // 标记是否找到了视频元素
    let foundVideo = false;
    
    // 首先检查视频URL缓存 - 如果有缓存的视频URL，直接返回视频，不处理图片
    if (videoUrlCache.has(tweetId)) {
      const videoUrl = videoUrlCache.get(tweetId);
      log(`使用缓存的视频URL: ${videoUrl}，跳过图片处理`);
      
      mediaElements.push({
        type: 'video',
        url: videoUrl,
        element: null,
        tweetId: tweetId,
        isHighQuality: true
      });
      
      // 更新缓存并返回，不再查找图片
      mediaDetectionCache.set(tweetId, {
        elements: mediaElements,
        timestamp: now
      });
      
      log('已找到视频，返回单个视频元素');
      return mediaElements;
    }
    
    // 视频检测 - 优先检测视频元素
    // 组合所有视频相关选择器到一个查询中
    const videoSelectors = [
      'video', 
      '[data-testid="videoPlayer"] video', 
      'div[data-testid="videoComponent"] video',
      'video[src]',
      'video[poster]'
    ];
    
    const combinedVideoSelector = videoSelectors.join(', ');
    const videos = tweet.querySelectorAll(combinedVideoSelector);
    
    if (videos.length > 0) {
      log(`找到 ${videos.length} 个视频元素，优先处理视频`);
      foundVideo = true;
      
      for (const video of videos) {
        // 尝试获取视频的真实URL
        const videoUrl = video.getAttribute('src') || 
                        video.getAttribute('data-url') || 
                        video.dataset.url || 
                        (video.querySelector('source') ? video.querySelector('source').src : null);
        
        if (videoUrl) {
          if (videoUrl.startsWith('blob:')) {
            // 对于blob URL，需要获取真实URL
            const isAlreadyAdded = mediaElements.some(media => 
              media.type === 'video' && media.isBlob && media.tweetId === tweetId
            );
            
            if (!isAlreadyAdded) {
              mediaElements.push({
                type: 'video',
                url: videoUrl,
                tweetUrl: window.location.origin + '/i/status/' + tweetId,
                element: video,
                isBlob: true,
                tweetId: tweetId
              });
            }
          } else if (!videoUrl.startsWith('blob:')) {
            // 非blob URL可以直接使用
            const isAlreadyAdded = mediaElements.some(media => 
              media.type === 'video' && media.url === videoUrl
            );
            
            if (!isAlreadyAdded) {
              mediaElements.push({
                type: 'video',
                url: videoUrl,
                element: video,
                tweetId: tweetId
              });
            }
          }
        }
      }
    }
    
    // 查找视频播放器组件（如果还没有找到视频元素）
    if (!mediaElements.some(media => media.type === 'video')) {
      const videoPlayerSelectors = [
        '[data-testid="videoPlayer"]', 
        '[data-testid="videoComponent"]',
        'div[data-testid="videoPlayer"]',
        'div[role="button"][aria-label*="Play"]',
        'div[data-testid="videoPlayer"] div[role="button"]'
      ];
      
      const combinedPlayerSelector = videoPlayerSelectors.join(', ');
      const videoCovers = tweet.querySelectorAll(combinedPlayerSelector);
      
      if (videoCovers.length > 0) {
        log(`找到视频播放器组件，可能有视频`);
        foundVideo = true;
        
        const isAlreadyAdded = mediaElements.some(media => 
          media.type === 'video' && media.needsExtraction && media.tweetId === tweetId
        );
        
        if (!isAlreadyAdded) {
          mediaElements.push({
            type: 'video',
            url: null,
            element: videoCovers[0],
            tweetId: tweetId,
            needsExtraction: true
          });
          
          // 异步启动视频URL获取，不阻塞当前处理
          if (config.enableHighQuality && tweetId) {
            setTimeout(() => {
              if (isExtensionContextValid()) {
                safeRuntimeSendMessage({
                  action: 'fetchVideoUrl',
                  tweetId: tweetId
                });
              }
            }, 0);
          }
        }
      }
    }
    
    // 如果已经找到视频元素，则不处理图片(这是关键的逻辑优化)
    if (foundVideo || mediaElements.some(media => media.type === 'video')) {
      log('已找到视频元素，跳过图片处理，返回视频元素');
      
      // 更新缓存
      mediaDetectionCache.set(tweetId, {
        elements: mediaElements,
        timestamp: now
      });
      
      return mediaElements;
    }
    
    // 只有在没有找到视频元素的情况下才处理图片
    log('未找到视频元素，开始处理图片');
    
    // 增强图片检测逻辑
    const imageSelectors = [
      'img[src*="pbs.twimg.com/media"]', 
      '[data-testid="tweetPhoto"] img', 
      '[data-testid="tweetPhotoContainer"] img', 
      'a[href*="/photo/"] img', 
      'img[src*="twimg.com"]:not([src*="video_thumb"]):not([src*="amplify_video"])',
      'div[data-testid="tweetPhoto"] img',
      'div[aria-label*="Image"] img'
    ];
    
    // 合并所有图片选择器为一个查询，减少DOM操作
    const combinedImageSelector = imageSelectors.join(', ');
    const images = tweet.querySelectorAll(combinedImageSelector);
    
    log(`找到 ${images.length} 个潜在图片元素`);
    
    // 处理图片
    for (const img of images) {
      // 首先检查这是否是视频封面图片
      const src = img.src || '';
      const isVideoThumbnail = src.includes('ext_tw_video_thumb') || 
                              src.includes('amplify_video_thumb') || 
                              img.closest('[data-testid="videoPlayer"]') !== null;
      
      // 跳过视频封面图片
      if (isVideoThumbnail) {
        log('跳过视频封面图片:', src);
        continue;
      }
      
      // 只处理足够大的图片，跳过小图标
      if ((img.complete && img.width > 100 && img.height > 100) || 
          (img.src && img.src.includes('pbs.twimg.com/media'))) {
          
        let imageUrl = img.src;
          
        // 优化高质量图片URL
        if (config.enableHighQuality && imageUrl.includes('pbs.twimg.com/media/')) {
          try {
            const urlObj = new URL(imageUrl);
            const baseUrl = urlObj.origin + urlObj.pathname;
            const format = urlObj.searchParams.get('format') || 'jpg';
            imageUrl = `${baseUrl}?format=${format}&name=orig`;
          } catch (e) {
            // 保持原始URL
          }
        }
          
        // 添加有效的图片URL，确保不重复
        if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
          // 检查是否已经有相同URL的图片
          const isDuplicate = mediaElements.some(media => 
            media.type === 'image' && media.url === imageUrl
          );
          
          // 如果不是重复的，添加到结果
          if (!isDuplicate) {
            mediaElements.push({
              type: 'image',
              url: imageUrl,
              element: img,
              tweetId: tweetId,
              isVideoThumbnail: false // 明确标记不是视频封面
            });
          }
        }
      }
    }
    
    // 更新缓存（仅当有媒体元素时）
    if (mediaElements.length > 0) {
      mediaDetectionCache.set(tweetId, {
        elements: mediaElements,
        timestamp: now
      });
    }
    
    log(`最终确认: 推文中有 ${mediaElements.length} 个有效媒体元素`);
    return mediaElements;
  } catch (error) {
    log('查找媒体元素时出错:', error);
    console.error('查找媒体元素时出错:', error);
    return mediaElements;
  }
}

// 下载媒体文件
function downloadMedia(media) {
  try {
    log('尝试下载媒体, 类型:', media ? media.type : 'undefined');
    
    // 首先检查扩展上下文是否有效
    if (!isExtensionContextValid()) {
      showExtensionContextError();
      return;
    }
    
    // 如果是复合媒体对象（数组），检查是否包含视频
    if (Array.isArray(media)) {
      const videoMedia = media.find(m => m.type === 'video');
      if (videoMedia) {
        log('检测到复合媒体中包含视频，优先下载视频');
        return downloadMedia(videoMedia);
      }
      
      // 如果没有视频，使用第一个媒体
      if (media.length > 0) {
        return downloadMedia(media[0]);
      }
      
      alert('下载失败：无效的媒体数据');
      return;
    }
    
    if (!media) {
      alert('下载失败：无效的媒体数据');
      return;
    }
    
    // 检查媒体类型
    if (!media.type) {
      log('未指定媒体类型，假设为图片');
      media.type = 'image';
    }
    
    // 如果是视频封面图片且有tweetId，尝试改为下载视频
    if (media.type === 'image' && media.isVideoThumbnail && media.tweetId) {
      log('尝试下载视频封面对应的视频');
      return directDownloadVideo(media.tweetId);
    }
    
    // 处理提取类型视频
    if (media.type === 'video' && media.needsExtraction && media.tweetId) {
      log('需要提取视频，使用推文ID获取视频链接');
      directDownloadVideo(media.tweetId);
      return;
    }
    
    // 验证URL
    if (!media.url) {
      log('媒体缺少URL');
      
      // 尝试通过推文ID获取视频
      if (media.tweetId) {
        log(`尝试使用推文ID ${media.tweetId} 获取视频`);
        directDownloadVideo(media.tweetId);
        return;
      }
      
      alert('下载失败：无效的媒体URL');
      return;
    }
    
    // 验证URL格式
    if (typeof media.url !== 'string') {
      log(`URL类型错误: ${typeof media.url}`);
      alert('下载失败：无效的媒体URL格式');
      return;
    }
    
    log(`尝试下载媒体: ${media.type}, URL: ${media.url}`);
    
    // 如果是blob URL的视频，并且我们有推文ID
    if (media.type === 'video' && media.url.startsWith('blob:') && media.tweetId) {
      // 显示加载指示器
      showVideoLoadingIndicator(media.tweetId);
      
      // 再次检查扩展上下文
      if (!isExtensionContextValid()) {
        hideVideoLoadingIndicator();
        showExtensionContextError();
        return;
      }
      
      // 发送消息给background.js尝试获取真实视频URL
      safeRuntimeSendMessage({
        action: 'fetchVideoUrl',
        tweetId: media.tweetId
      }, function(response) {
        // 检查是否有运行时错误
        if (chrome.runtime.lastError) {
          log('获取视频URL时出错:', chrome.runtime.lastError);
          hideVideoLoadingIndicator();
          handleRuntimeError(chrome.runtime.lastError);
          return;
        }
        
        // 隐藏加载指示器
        hideVideoLoadingIndicator();
        
        if (response && response.videoUrl) {
          log(`获取到真实视频URL: ${response.videoUrl}`);
          // 更新缓存
          videoUrlCache.set(media.tweetId, response.videoUrl);
          // 用真实URL重新下载
          downloadMedia({
            type: 'video',
            url: response.videoUrl,
            tweetId: media.tweetId
          });
        } else {
          log('无法获取视频链接，尝试直接下载');
          // 尝试直接使用blob URL下载
          if (media.url) {
            if (!isExtensionContextValid()) {
              showExtensionContextError();
              return;
            }
            
            safeRuntimeSendMessage({
              action: 'downloadMedia',
              url: media.url,
              filename: `twitter_video_${media.tweetId}.mp4`
            }, function(response) {
              if (response && response.error) {
                log('使用blob URL下载失败:', response.error);
                alert('无法获取视频链接，请尝试右键视频并选择"复制视频地址"，然后手动下载');
              }
            });
          } else {
            alert('无法获取视频链接，请尝试右键视频并选择"复制视频地址"，然后手动下载');
          }
        }
      });
      return;
    }
    
    // 处理非blob URL，但确保是HTTP(S)开头
    if (!media.url.startsWith('http')) {
      log(`非HTTP URL: ${media.url}`);
      alert('下载失败：无效的媒体URL协议');
      return;
    }
    
    // 从URL提取文件名
    let filename = '';
    try {
      const urlObj = new URL(media.url);
      filename = urlObj.pathname.split('/').pop();
      
      // 如果路径末尾有查询参数，去除它们
      if (filename.includes('?')) {
        filename = filename.split('?')[0];
      }
      
      // 检查文件名是否为空或无效
      if (!filename || filename === '/' || filename.length < 3) {
        // 使用时间戳生成文件名
        const timestamp = new Date().getTime();
        filename = `twitter_media_${timestamp}`;
      }
    } catch (e) {
      log('解析URL时出错:', e);
      // 使用备用文件名
      const timestamp = new Date().getTime();
      filename = `twitter_media_${timestamp}`;
    }
    
    // 添加文件扩展名（如果没有）
    if (media.type === 'video' && !filename.match(/\.(mp4|mov|webm|avi)$/i)) {
      filename += '.mp4';
    } else if (media.type === 'image' && !filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      // 尝试从URL中获取格式
      if (media.url.includes('format=')) {
        try {
          const params = new URLSearchParams(media.url.split('?')[1]);
          const format = params.get('format');
          if (format) {
            filename += '.' + format;
          } else {
            filename += '.jpg';
          }
        } catch (e) {
          filename += '.jpg';
        }
      } else {
        filename += '.jpg';
      }
    }
    
    log(`准备下载文件: ${filename}`);
    
    // 再次检查扩展上下文
    if (!isExtensionContextValid()) {
      showExtensionContextError();
      return;
    }
    
    // 使用安全的方式发送消息
    safeRuntimeSendMessage({
      action: 'downloadMedia',
      url: media.url,
      filename: filename
    }, function(response) {
      // 检查是否有运行时错误
      if (chrome.runtime.lastError) {
        log('下载媒体时出错:', chrome.runtime.lastError);
        handleRuntimeError(chrome.runtime.lastError);
        return;
      }
      
      if (response && response.error) {
        log('下载失败:', response.error);
        alert('下载失败: ' + response.error);
      } else if (response && response.success) {
        log('下载已开始，ID:', response.downloadId);
      } else {
        log('下载可能已开始，但没有收到确认');
      }
    });
  } catch (error) {
    log('下载媒体时发生异常:', error);
    console.error('下载媒体时发生异常:', error);
    
    // 显示友好的错误消息
    if (error.message && error.message.includes('Extension context invalidated')) {
      showExtensionContextError();
    } else {
      alert('下载过程中发生错误，请尝试刷新页面后重试');
    }
  }
}

// 视频加载步骤定义
const videoLoadingSteps = [
  { id: 'parse', name: '解析视频ID', completed: false },
  { id: 'fetch', name: '获取视频页面', completed: false },
  { id: 'extract', name: '提取视频链接', completed: false },
  { id: 'prepare', name: '准备下载', completed: false }
];

// 显示视频加载进度指示器
function showVideoLoadingIndicator(tweetId) {
  // 删除已经存在的指示器
  hideVideoLoadingIndicator();
  
  // 重置步骤状态
  videoLoadingSteps.forEach(step => step.completed = false);
  
  // 创建指示器元素
  const indicator = document.createElement('div');
  indicator.className = 'x-downloading-indicator x-video-loading-indicator';
  
  // 创建步骤HTML
  const stepsHtml = videoLoadingSteps.map(step => 
    `<div class="x-step-item" data-step-id="${step.id}">
      <div class="x-step-icon"></div>
      <div class="x-step-text">${step.name}</div>
    </div>`
  ).join('');
  
  indicator.innerHTML = `
    <div class="x-indicator-content">
      <div class="x-loading"></div>
      <div class="x-step-heading">正在获取视频链接... <span class="x-elapsed-time">(0秒)</span></div>
      
      <div class="x-steps-container">
        ${stepsHtml}
      </div>
      
      <div class="x-indeterminate-progress">
        <div class="x-progress-track"></div>
      </div>
    </div>
  `;
  
  // 添加点击事件以允许取消
  indicator.addEventListener('click', function(e) {
    if (e.target === indicator) {
      hideVideoLoadingIndicator();
    }
  });
  
  // 将指示器添加到页面
  document.body.appendChild(indicator);
  
  // 存储开始时间以便显示加载持续时间
  indicator.dataset.startTime = Date.now();
  indicator.dataset.tweetId = tweetId;
  
  // 启动更新计时器
  indicator._timer = setInterval(() => {
    updateVideoLoadingProgress();
  }, 500);
  
  // 立即将第一步标记为进行中
  updateVideoLoadingStep('parse', 'progress');
  
  // 模拟步骤进度
  simulateStepProgress();
}

// 模拟步骤进度（实际使用时应由实际进度触发）
function simulateStepProgress() {
  // 解析视频ID (立即完成)
  setTimeout(() => updateVideoLoadingStep('parse', 'complete'), 700);
  
  // 获取视频页面
  setTimeout(() => updateVideoLoadingStep('fetch', 'progress'), 800);
  setTimeout(() => updateVideoLoadingStep('fetch', 'complete'), 2500);
  
  // 提取视频链接
  setTimeout(() => updateVideoLoadingStep('extract', 'progress'), 2600);
  setTimeout(() => updateVideoLoadingStep('extract', 'complete'), 4000);
  
  // 准备下载
  setTimeout(() => updateVideoLoadingStep('prepare', 'progress'), 4100);
  setTimeout(() => updateVideoLoadingStep('prepare', 'complete'), 5000);
}

// 更新视频加载步骤
function updateVideoLoadingStep(stepId, status) {
  const indicator = document.querySelector('.x-video-loading-indicator');
  if (!indicator) return;
  
  const stepItem = indicator.querySelector(`.x-step-item[data-step-id="${stepId}"]`);
  if (!stepItem) return;
  
  // 移除所有状态类
  stepItem.classList.remove('x-step-progress', 'x-step-complete', 'x-step-error');
  
  // 添加对应状态类
  switch (status) {
    case 'progress':
      stepItem.classList.add('x-step-progress');
      break;
    case 'complete':
      stepItem.classList.add('x-step-complete');
      // 更新步骤状态
      const stepIndex = videoLoadingSteps.findIndex(step => step.id === stepId);
      if (stepIndex !== -1) {
        videoLoadingSteps[stepIndex].completed = true;
      }
      break;
    case 'error':
      stepItem.classList.add('x-step-error');
      break;
  }
  
  // 如果是最后一步完成，准备隐藏指示器
  if (stepId === 'prepare' && status === 'complete') {
    const allComplete = videoLoadingSteps.every(step => step.completed);
    if (allComplete) {
      // 延迟一小段时间后隐藏，让用户能看到所有步骤已完成
      setTimeout(() => {
        hideVideoLoadingIndicator();
      }, 1000);
    }
  }
}

// 更新视频加载进度
function updateVideoLoadingProgress() {
  const indicator = document.querySelector('.x-video-loading-indicator');
  if (!indicator) return;
  
  // 计算已经过去的时间（秒）
  const startTime = parseInt(indicator.dataset.startTime || '0');
  const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
  
  // 更新文本显示加载时间
  const timeDisplay = indicator.querySelector('.x-elapsed-time');
  if (timeDisplay) {
    timeDisplay.textContent = `(${elapsedTime}秒)`;
  }
}

// 隐藏视频加载进度指示器
function hideVideoLoadingIndicator() {
  const indicator = document.querySelector('.x-video-loading-indicator');
  if (indicator) {
    // 清除计时器
    if (indicator._timer) {
      clearInterval(indicator._timer);
    }
    
    // 移除指示器
    document.body.removeChild(indicator);
  }
}

// 直接下载视频 - 添加错误处理
function directDownloadVideo(tweetId, isBackground = false) {
  if (!tweetId) {
    alert('无法下载视频：找不到推文ID');
    return;
  }
  
  // 检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    showExtensionContextError();
    return;
  }
  
  log('尝试直接下载视频，推文ID:', tweetId);
  
  // 如果不是后台模式，显示加载指示器
  if (!isBackground) {
    showVideoLoadingIndicator(tweetId);
    // 解析视频ID步骤立即完成
    updateVideoLoadingStep('parse', 'complete');
  }
  
  // 更新获取视频页面步骤为进行中
  if (!isBackground) {
    updateVideoLoadingStep('fetch', 'progress');
  }
  
  // 使用强化服务获取视频URL
  safeRuntimeSendMessage({
    action: 'fetchVideoUrl',
    tweetId: tweetId,
    forceRefresh: true
  }, function(response) {
    // 检查是否有运行时错误
    if (chrome.runtime.lastError) {
      log('获取视频URL时出错:', chrome.runtime.lastError);
      if (!isBackground) {
        updateVideoLoadingStep('fetch', 'error');
        hideVideoLoadingIndicator();
      }
      handleRuntimeError(chrome.runtime.lastError);
      return;
    }
    
    // 如果不是后台模式
    if (!isBackground) {
      // 标记获取视频页面步骤为完成
      updateVideoLoadingStep('fetch', 'complete');
      
      if (response && response.videoUrl) {
        // 标记提取视频链接步骤为进行中然后完成
        updateVideoLoadingStep('extract', 'progress');
        setTimeout(() => {
          updateVideoLoadingStep('extract', 'complete');
          
          // 标记准备下载步骤为进行中然后完成
          updateVideoLoadingStep('prepare', 'progress');
          setTimeout(() => {
            updateVideoLoadingStep('prepare', 'complete');
          }, 500);
        }, 500);
      } else {
        // 如果未找到视频链接，标记为错误
        updateVideoLoadingStep('extract', 'error');
        setTimeout(() => hideVideoLoadingIndicator(), 1500);
      }
    }
    
    if (response && response.videoUrl) {
      log('获取到视频URL:', response.videoUrl);
      
      // 检查扩展上下文是否有效
      if (!isExtensionContextValid()) {
        if (!isBackground) {
          hideVideoLoadingIndicator();
        }
        showExtensionContextError();
        return;
      }
      
      // 直接下载视频文件
      safeRuntimeSendMessage({
        action: 'downloadMedia',
        url: response.videoUrl,
        filename: `twitter_video_${tweetId}.mp4`
      });
    } else {
      if (!isBackground) {
        setTimeout(() => {
          hideVideoLoadingIndicator();
          alert('无法获取视频链接，请尝试右键视频并选择"复制视频地址"，然后手动下载');
        }, 1500);
      }
    }
  });
}

// 测试刷新下载按钮
function refreshDownloadButtons() {
  // 移除所有现有的下载按钮
  const existingButtons = document.querySelectorAll(`.${config.downloadButtonClass}`);
  existingButtons.forEach(button => {
    if (button && button.parentNode) {
      const container = button.closest('.x-download-button-container');
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      } else {
        button.parentNode.removeChild(button);
      }
    }
  });
  
  // 移除所有工具提示
  document.querySelectorAll('.x-tooltip').forEach(tooltip => {
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
  });
  
  // 清空已处理推文集合以便重新添加按钮
  processedTweets.clear();
  
  // 清空媒体检测缓存
  mediaDetectionCache.clear();
  
  // 重置所有已处理标记
  document.querySelectorAll('[data-x-processed]').forEach(el => {
    el.removeAttribute('data-x-processed');
  });
  
  log('已清除所有现有下载按钮和处理标记，准备重新扫描');
  
  // 使用短暂延迟确保DOM更新完成
  setTimeout(() => {
    // 强制重新检查所有推文
    scanTweets();
    
    // 再次延迟扫描，确保捕获可能的异步加载内容
    setTimeout(scanTweets, 1000);
    
    // 在控制台显示刷新完成信息
    console.log('[X视频下载助手] 已刷新所有下载按钮，请检查显示效果');
    
    // 添加辅助信息，帮助用户排查问题
    console.log('[X视频下载助手] 如果按钮仍未显示，请尝试刷新页面，或查看控制台是否有错误信息');
  }, 100);
}

// 设置消息监听器 - 独立函数便于在初始化前启动
function setupMessageListener() {
  // 设置消息监听器 - 用于接收设置更改或后台脚本发送的视频URL
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // 处理设置变更
    if (request.action === 'settingsChanged' || request.action === 'updateSettings') {
      log('接收到设置变更:', request);
      
      // 确定要处理的设置对象
      const settingsToApply = request.action === 'updateSettings' ? request.settings : request.settings;
      
      // 更新配置
      if (settingsToApply.enabled !== undefined) {
        const wasEnabled = config.enabled;
        config.enabled = settingsToApply.enabled;
        
        // 如果启用状态改变
        if (wasEnabled !== config.enabled) {
          if (config.enabled) {
            // 如果从禁用变为启用，重新扫描页面
            scanTweets();
          } else {
            // 如果从启用变为禁用，移除所有下载按钮
            removeAllDownloadButtons();
          }
        }
      } else if (settingsToApply.enableDownloadBtn !== undefined) {
        // 兼容旧版设置格式
        const wasEnabled = config.enabled;
        config.enabled = settingsToApply.enableDownloadBtn;
        
        // 如果启用状态改变
        if (wasEnabled !== config.enabled) {
          if (config.enabled) {
            // 如果从禁用变为启用，重新扫描页面
            scanTweets();
          } else {
            // 如果从启用变为禁用，移除所有下载按钮
            removeAllDownloadButtons();
          }
        }
      }
      
      if (settingsToApply.enableHighQuality !== undefined) {
        config.enableHighQuality = settingsToApply.enableHighQuality;
      }
      
      if (settingsToApply.downloadInBackground !== undefined) {
        config.downloadInBackground = settingsToApply.downloadInBackground;
      }
      
      log(`更新配置 - 启用状态: ${config.enabled}, 高质量: ${config.enableHighQuality}, 后台下载: ${config.downloadInBackground}`);
      
      // 不管设置有没有变化，都强制重新扫描一次
      if (config.enabled) {
        // 清除媒体检测缓存
        mediaDetectionCache.clear();
        // 清除所有已处理标记
        document.querySelectorAll('[data-x-processed]').forEach(el => {
          el.removeAttribute('data-x-processed');
        });
        // 重新扫描
        setTimeout(scanTweets, 500);
      }
      
      // 告知发送者设置已应用
      sendResponse({
        success: true,
        message: '设置已更新',
        currentSettings: {
          enabled: config.enabled,
          enableHighQuality: config.enableHighQuality,
          downloadInBackground: config.downloadInBackground
        }
      });
      
      // 为确保UI更新，延迟再次扫描
      setTimeout(scanTweets, 2000);
    }
    
    // 处理获取到的视频URL
    else if (request.action === 'videoUrlFetched' && request.tweetId && request.videoUrl) {
      log(`接收到视频URL: ${request.videoUrl} 对应推文ID: ${request.tweetId}`);
      
      // 缓存视频URL
      videoUrlCache.set(request.tweetId, request.videoUrl);
      
      // 清理对应推文的媒体检测缓存，以便下次检测能找到视频
      if (mediaDetectionCache.has(request.tweetId)) {
        mediaDetectionCache.delete(request.tweetId);
      }
      
      // 重新处理相关推文
      const tweetElements = document.querySelectorAll(`[data-tweet-id="${request.tweetId}"], [data-testid="tweet"][data-tweet-id="${request.tweetId}"]`);
      
      log(`找到 ${tweetElements.length} 个相关推文元素需要更新`);
      
      tweetElements.forEach(tweet => {
        // 移除已处理标记，以便重新处理
        tweet.removeAttribute('data-x-processed');
        processTweet(tweet);
      });
      
      sendResponse({
        success: true,
        message: `视频URL已缓存并更新UI: ${request.videoUrl}`
      });
    }
    
    // 处理强制刷新下载按钮的请求
    else if (request.action === 'refreshDownloadButtons') {
      log('收到强制刷新下载按钮的请求');
      
      if (config.enabled) {
        // 移除所有现有按钮
        removeAllDownloadButtons();
        
        // 清除缓存
        mediaDetectionCache.clear();
        
        // 清除已处理标记
        document.querySelectorAll('[data-x-processed]').forEach(el => {
          el.removeAttribute('data-x-processed');
        });
        
        // 重新扫描页面
        scanTweets();
        
        // 向发送者响应
        sendResponse({
          success: true,
          message: '已刷新所有下载按钮'
        });
      } else {
        sendResponse({
          success: false,
          message: '插件当前已禁用，无法刷新按钮'
        });
      }
      
      return true; // 保持消息通道打开
    }
    
    // 检查扩展是否初始化的请求 - 用于测试通信
    else if (request.action === 'checkInitialized') {
      sendResponse({
        success: true,
        initialized: extensionInitialized,
        message: extensionInitialized ? '扩展已初始化' : '扩展正在初始化中'
      });
    }
    
    // 为了保持消息通道打开，返回true
    return true;
  });
}

// 启动脚本
init();

// 添加辅助函数来检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    // 尝试访问chrome.runtime.id，如果上下文失效会抛出异常
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    log('扩展上下文已失效:', e);
    return false;
  }
}

// 显示扩展上下文错误
function showExtensionContextError() {
  // 显示友好的错误消息
  alert('扩展上下文已失效，请刷新页面后重试。如果问题持续存在，请尝试重新启用扩展。');
}

// 处理运行时错误
function handleRuntimeError(error) {
  log('运行时错误:', error);
  
  if (error && error.message && error.message.includes('Extension context invalidated')) {
    showExtensionContextError();
  } else if (error) {
    alert('下载过程中出现错误，请刷新页面后重试: ' + error.message);
  } else {
    alert('下载过程中出现未知错误，请刷新页面后重试');
  }
}

// 安全的发送消息函数
function safeRuntimeSendMessage(message, callback) {
  try {
    if (!isExtensionContextValid()) {
      log('尝试在无效上下文中发送消息');
      if (callback) {
        callback({ error: 'Extension context invalidated' });
      }
      return;
    }
    
    chrome.runtime.sendMessage(message, callback || function() {});
  } catch (error) {
    log('发送消息时出错:', error);
    if (callback) {
      callback({ error: error.message });
    }
    
    if (error.message && error.message.includes('Extension context invalidated')) {
      showExtensionContextError();
    }
  }
}