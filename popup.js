// X视频下载助手设置脚本

document.addEventListener('DOMContentLoaded', function() {
  // 获取DOM元素
  const enableDownloadBtn = document.getElementById('enableDownloadBtn');
  const enableHighQuality = document.getElementById('enableHighQuality');
  const enableBatchDownload = document.getElementById('enableBatchDownload');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toast = document.getElementById('toast');
  const statusIndicator = document.getElementById('statusIndicator') || document.createElement('div');
  
  // 设置状态指示器
  if (!statusIndicator.id) {
    statusIndicator.id = 'statusIndicator';
    statusIndicator.className = 'status-indicator';
    document.body.insertBefore(statusIndicator, document.body.firstChild);
  }
  
  // 默认设置
  const defaultSettings = {
    enableDownloadBtn: true,
    enableHighQuality: true,
    enableBatchDownload: true,
    lastUpdated: Date.now()
  };
  
  // 从存储中加载设置
  loadSettings();
  
  // 检查通信状态
  checkContentScriptCommunication();
  
  // 保存按钮点击事件
  saveBtn.addEventListener('click', saveSettings);
  
  // 重置按钮点击事件
  resetBtn.addEventListener('click', resetSettings);
  
  // 加载设置
  function loadSettings() {
    chrome.storage.sync.get({
      settings: defaultSettings
    }, function(data) {
      // 将设置值应用到UI
      enableDownloadBtn.checked = data.settings.enableDownloadBtn;
      enableHighQuality.checked = data.settings.enableHighQuality;
      enableBatchDownload.checked = data.settings.enableBatchDownload;
      
      // 更新内容脚本中的设置
      updateContentScriptSettings(data.settings);
    });
  }
  
  // 保存设置
  function saveSettings() {
    const settings = {
      enableDownloadBtn: enableDownloadBtn.checked,
      enableHighQuality: enableHighQuality.checked,
      enableBatchDownload: enableBatchDownload.checked,
      lastUpdated: Date.now()
    };
    
    chrome.storage.sync.set({
      settings: settings
    }, function() {
      // 显示保存成功提示
      showToast('设置已保存');
      
      // 更新内容脚本中的设置
      updateContentScriptSettings(settings);
    });
  }
  
  // 重置设置
  function resetSettings() {
    // 将UI恢复为默认值
    enableDownloadBtn.checked = defaultSettings.enableDownloadBtn;
    enableHighQuality.checked = defaultSettings.enableHighQuality;
    enableBatchDownload.checked = defaultSettings.enableBatchDownload;
    
    // 保存默认设置
    chrome.storage.sync.set({
      settings: defaultSettings
    }, function() {
      showToast('设置已重置为默认值');
      
      // 更新内容脚本中的设置
      updateContentScriptSettings(defaultSettings);
    });
  }
  
  // 向内容脚本发送设置更新
  function updateContentScriptSettings(settings) {
    // 获取所有Twitter/X标签页，而不仅仅是当前活跃的
    chrome.tabs.query({
      url: ["*://twitter.com/*", "*://x.com/*"]
    }, function(tabs) {
      if (tabs && tabs.length > 0) {
        console.log('找到', tabs.length, '个Twitter/X标签页');
        
        // 将旧格式转换为新格式（兼容性处理）
        const updatedSettings = {
          enabled: settings.enableDownloadBtn !== undefined ? settings.enableDownloadBtn : true,
          enableHighQuality: settings.enableHighQuality !== undefined ? settings.enableHighQuality : true,
          downloadInBackground: false,  // 默认不在后台下载
          enableBatchDownload: settings.enableBatchDownload !== undefined ? settings.enableBatchDownload : true
        };
        
        // 同时保存设置到存储中，确保其他地方也能正确读取
        chrome.storage.sync.set({
          'enabled': updatedSettings.enabled,
          'enableHighQuality': updatedSettings.enableHighQuality,
          'downloadInBackground': updatedSettings.downloadInBackground
        }, function() {
          console.log('设置已保存到存储');
        });
        
        // 遍历所有匹配的标签页
        for (const tab of tabs) {
          console.log('向标签页', tab.id, '发送更新');
          
          // 发送新格式的消息，使用统一的格式
          try {
            chrome.tabs.sendMessage(tab.id, {
              action: 'settingsChanged',
              settings: updatedSettings
            }, function(response) {
              // 检查响应，记录任何错误
              if (chrome.runtime.lastError) {
                console.log('向标签页 ' + tab.id + ' 发送消息时出错: ', chrome.runtime.lastError);
                
                // 尝试刷新内容脚本
                refreshContentScript(tab.id);
              } else if (response && response.success) {
                console.log('标签页 ' + tab.id + ' 设置已更新:', response);
                
                // 仅在成功收到响应后尝试刷新按钮
                setTimeout(() => {
                  chrome.tabs.sendMessage(tab.id, {
                    action: 'refreshDownloadButtons'
                  }, function(btnResponse) {
                    // 忽略此处的错误，因为可能在刷新后响应不及时
                  });
                }, 500);
              }
            });
          } catch (err) {
            console.error('发送消息时发生错误:', err);
          }
        }
        
        // 显示成功消息
        showToast('设置已更新，可能需要刷新页面才能生效');
      } else {
        console.log('未找到Twitter/X标签页');
        // 仍然保存设置到存储中，以便标签页打开时能读取
        chrome.storage.sync.set({
          'enabled': settings.enableDownloadBtn,
          'enableHighQuality': settings.enableHighQuality,
          'downloadInBackground': false
        });
        
        // 显示未找到标签页的提示
        showToast('未找到打开的Twitter/X页面，请打开Twitter后重试', true);
      }
    });
  }
  
  // 尝试刷新内容脚本
  function refreshContentScript(tabId) {
    console.log('尝试在标签页 ' + tabId + ' 上重新注入内容脚本');
    // 使用chrome.scripting API刷新内容脚本 (仅在Manifest V3中可用)
    if (chrome.scripting) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => { 
          // 通知页面刷新扩展
          window.location.reload();
        }
      }).catch(err => {
        console.error('执行脚本出错:', err);
      });
    }
  }
  
  // 检查与内容脚本的通信
  function checkContentScriptCommunication() {
    // 获取所有Twitter/X标签页
    chrome.tabs.query({
      url: ["*://twitter.com/*", "*://x.com/*"]
    }, function(tabs) {
      if (tabs && tabs.length > 0) {
        statusIndicator.textContent = '正在检查扩展状态...';
        statusIndicator.className = 'status-indicator loading';
        
        // 检查第一个标签页的状态
        const tab = tabs[0];
        try {
          chrome.tabs.sendMessage(tab.id, {
            action: 'checkInitialized'
          }, function(response) {
            if (chrome.runtime.lastError) {
              console.log('通信检查出错:', chrome.runtime.lastError);
              statusIndicator.textContent = '⚠️ 无法与Twitter页面通信，请尝试刷新Twitter页面';
              statusIndicator.className = 'status-indicator error';
            } else if (response && response.success) {
              statusIndicator.textContent = '✅ 扩展正常运行中';
              statusIndicator.className = 'status-indicator success';
            } else {
              statusIndicator.textContent = '⚠️ 扩展响应异常，请刷新Twitter页面';
              statusIndicator.className = 'status-indicator warning';
            }
          });
        } catch (err) {
          console.error('发送检查消息时出错:', err);
          statusIndicator.textContent = '❌ 通信错误，请刷新Twitter页面后重试';
          statusIndicator.className = 'status-indicator error';
        }
      } else {
        statusIndicator.textContent = '❌ 未检测到已打开的Twitter/X页面';
        statusIndicator.className = 'status-indicator error';
      }
    });
  }
  
  // 显示提示消息
  function showToast(message, isError = false) {
    toast.textContent = message;
    
    // 如果是错误消息，添加错误样式
    if (isError) {
      toast.classList.add('error');
    } else {
      toast.classList.remove('error');
    }
    
    // 显示提示
    toast.classList.remove('hidden');
    
    // 设置定时器隐藏提示
    setTimeout(function() {
      toast.classList.add('hidden');
    }, 2000);
  }
}); 