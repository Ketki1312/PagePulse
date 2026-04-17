// background.js — Service Worker for PagePulse

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    // Content script should already be injected, but ping it to re-collect
    chrome.tabs.sendMessage(tabId, { type: 'COLLECT_TIMING' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready, try injecting
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).catch(() => {});
      }
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TIMING_DATA' && sender.tab) {
    const tabId = sender.tab.id;
    const storageKey = `timing_${tabId}`;
    
    chrome.storage.local.set({ [storageKey]: message.data }, () => {
      sendResponse({ success: true });
    });
    
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'GET_TIMING') {
    const tabId = message.tabId;
    const storageKey = `timing_${tabId}`;
    
    chrome.storage.local.get([storageKey], (result) => {
      sendResponse({ data: result[storageKey] || null });
    });
    
    return true;
  }
});

// Clean up storage when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  const storageKey = `timing_${tabId}`;
  chrome.storage.local.remove([storageKey]);
});
