// P0 探针 service worker：点击后在当前小红书页面注入探针并执行一次采集。
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https:\/\/(www\.)?xiaohongshu\.com\//.test(tab.url || '')) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: '请在小红书页面点击' });
    return;
  }
  // 按需申请资源域读取权限（探针阶段直接请求全部 https，实测后收敛）。
  const granted = await chrome.permissions.request({ origins: ['https://*/*'] }).catch(() => false);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['probe.js'] });
    if (granted === false) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert('未授予资源域读取权限：探针将只能记录 DOM，不能读取图片字节。'),
      });
    }
  } catch (e) {
    console.error('probe inject failed', e);
  }
});
