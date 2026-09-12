
document.getElementById('open-dash')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/dashboard/index.html') });
});
