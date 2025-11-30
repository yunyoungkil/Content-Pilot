// Content Pilot Popup Settings
document.addEventListener('DOMContentLoaded', function() {
    const autoRunToggle = document.getElementById('autoRunToggle');
    const statusText = document.getElementById('statusText');
    const activateButton = document.getElementById('activateButton');
    const activationStatus = document.getElementById('activationStatus');

    // Load current setting
    chrome.storage.local.get(['autoRunEnabled'], function(result) {
        const isEnabled = result.autoRunEnabled !== false; // Default to true
        autoRunToggle.checked = isEnabled;
        updateStatusText(isEnabled);
    });

    // Handle toggle changes
    autoRunToggle.addEventListener('change', function() {
        const isEnabled = autoRunToggle.checked;
        chrome.storage.local.set({ autoRunEnabled: isEnabled }, function() {
            updateStatusText(isEnabled);
            // Notify content script of the change
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'updateAutoRunSetting',
                        enabled: isEnabled
                    }).catch(() => {
                        // Ignore errors for tabs without content script
                    });
                });
            });
        });
    });

    // Handle activation button
    activateButton.addEventListener('click', function() {
        activationStatus.textContent = 'Activating...';

        // Get current active tab
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                // Send message to background script to activate Content Pilot
                chrome.runtime.sendMessage({
                    action: 'activate_content_pilot'
                }, function(response) {
                    if (response && response.success) {
                        activationStatus.textContent = 'Content Pilot activated!';
                        setTimeout(() => {
                            activationStatus.textContent = '';
                        }, 2000);
                    } else {
                        activationStatus.textContent = 'Activation failed: ' + (response ? response.error : 'Unknown error');
                    }
                });
            } else {
                activationStatus.textContent = 'No active tab found';
            }
        });
    });

    function updateStatusText(isEnabled) {
        statusText.textContent = isEnabled ?
            'Extension will run automatically on websites' :
            'Extension will only run when manually activated';
    }
});
