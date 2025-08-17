// Utility functions for the strategy game

// Notification system
function showNotification(message, type = 'info', duration = 5000) {
    const notifications = document.getElementById('notifications') || document.getElementById('gameNotifications');
    if (!notifications) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <p>${message}</p>
        </div>
    `;

    notifications.appendChild(notification);

    // Auto remove after duration
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'notificationSlideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notifications.removeChild(notification);
                }
            }, 300);
        }
    }, duration);
}

// Modal management
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Setup modal close functionality with configurable options
function setupModalCloseHandlers() {
    // Close modal when clicking the X button
    document.querySelectorAll('.modal .close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                hideModal(modal.id);
            }
        });
    });

    // Close modal when clicking outside of it (with exceptions for certain modals)
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                // Check if this modal should be closeable by outside click
                const isRaceSelectionModal = this.id === 'raceSelectionModal';
                
                if (!isRaceSelectionModal) {
                    hideModal(this.id);
                }
                // Race selection modal will NOT close when clicking outside
            }
        });
    });

    // Close modal with Escape key (with exceptions for certain modals)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal[style*="block"]');
            if (openModal) {
                // Check if this modal should be closeable by Escape key
                const isRaceSelectionModal = openModal.id === 'raceSelectionModal';
                
                if (!isRaceSelectionModal) {
                    hideModal(openModal.id);
                }
                // Race selection modal will NOT close with Escape key
            }
        }
    });
}

// Alternative approach: Function to make specific modals non-closeable
function makeModalPersistent(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Add a data attribute to mark this modal as persistent
    modal.setAttribute('data-persistent', 'true');
    
    // Remove existing outside-click handlers for this specific modal
    modal.removeEventListener('click', modal._outsideClickHandler);
    
    // Add new handler that respects the persistent flag
    modal._outsideClickHandler = function(e) {
        if (e.target === this && !this.hasAttribute('data-persistent')) {
            hideModal(this.id);
        }
    };
    
    modal.addEventListener('click', modal._outsideClickHandler);
}

// Function to make modal closeable again
function makeModalCloseable(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Remove the persistent attribute
    modal.removeAttribute('data-persistent');
}

// Enhanced setup function that respects persistent modals
function setupEnhancedModalCloseHandlers() {
    // Close modal when clicking the X button
    document.querySelectorAll('.modal .close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                hideModal(modal.id);
            }
        });
    });

    // Close modal when clicking outside of it (respecting persistent flag)
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this && !this.hasAttribute('data-persistent')) {
                hideModal(this.id);
            }
        });
    });

    // Close modal with Escape key (respecting persistent flag)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal[style*="block"]');
            if (openModal && !openModal.hasAttribute('data-persistent')) {
                hideModal(openModal.id);
            }
        }
    });
}

// Format time utilities
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Validation utilities
function validatePlayerName(name) {
    if (!name || name.trim().length === 0) {
        return { valid: false, message: 'Spielername ist erforderlich' };
    }
    
    if (name.trim().length < 2) {
        return { valid: false, message: 'Spielername muss mindestens 2 Zeichen lang sein' };
    }
    
    if (name.trim().length > 20) {
        return { valid: false, message: 'Spielername darf maximal 20 Zeichen lang sein' };
    }
    
    if (!/^[a-zA-Z0-9äöüÄÖÜß\s\-_]+$/.test(name.trim())) {
        return { valid: false, message: 'Spielername enthält ungültige Zeichen' };
    }
    
    return { valid: true };
}

function validateGameName(name) {
    if (!name || name.trim().length === 0) {
        return { valid: false, message: 'Spielname ist erforderlich' };
    }
    
    if (name.trim().length < 3) {
        return { valid: false, message: 'Spielname muss mindestens 3 Zeichen lang sein' };
    }
    
    if (name.trim().length > 50) {
        return { valid: false, message: 'Spielname darf maximal 50 Zeichen lang sein' };
    }
    
    return { valid: true };
}

// Local storage utilities
function saveToLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('Could not save to localStorage:', error);
    }
}

function loadFromLocalStorage(key, defaultValue = null) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : defaultValue;
    } catch (error) {
        console.warn('Could not load from localStorage:', error);
        return defaultValue;
    }
}

// Game state utilities
function getGameIdFromUrl() {
    const path = window.location.pathname;
    const matches = path.match(/\/game\/(\d+)/);
    return matches ? parseInt(matches[1]) : null;
}

// Color utilities
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function lightenColor(color, percent) {
    const rgb = hexToRgb(color);
    if (!rgb) return color;
    
    const factor = percent / 100;
    const r = Math.round(rgb.r + (255 - rgb.r) * factor);
    const g = Math.round(rgb.g + (255 - rgb.g) * factor);
    const b = Math.round(rgb.b + (255 - rgb.b) * factor);
    
    return rgbToHex(r, g, b);
}

function darkenColor(color, percent) {
    const rgb = hexToRgb(color);
    if (!rgb) return color;
    
    const factor = 1 - (percent / 100);
    const r = Math.round(rgb.r * factor);
    const g = Math.round(rgb.g * factor);
    const b = Math.round(rgb.b * factor);
    
    return rgbToHex(r, g, b);
}

// Canvas utilities
function clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function resizeCanvas(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
}

// Math utilities
function distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

// Array utilities
function shuffle(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function groupBy(array, key) {
    return array.reduce((groups, item) => {
        const group = item[key];
        if (!groups[group]) {
            groups[group] = [];
        }
        groups[group].push(item);
        return groups;
    }, {});
}

// Sound utilities (placeholder for future sound system)
function playSound(soundName) {
    // TODO: Implement sound system
    console.log(`Playing sound: ${soundName}`);
}

// Animation utilities
function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function animate(duration, callback, onComplete = null) {
    const startTime = performance.now();
    
    function tick(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        callback(easeInOut(progress));
        
        if (progress < 1) {
            requestAnimationFrame(tick);
        } else if (onComplete) {
            onComplete();
        }
    }
    
    requestAnimationFrame(tick);
}

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle utility
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Initialize utilities
document.addEventListener('DOMContentLoaded', function() {
    // Use the enhanced modal setup that respects persistent modals
    setupEnhancedModalCloseHandlers();
    
    // Add CSS for notification animations
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes notificationSlideOut {
                from {
                    opacity: 1;
                    transform: translateX(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(100%);
                }
            }
        `;
        document.head.appendChild(style);
    }
});

// Export for module systems (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showNotification,
        showModal,
        hideModal,
        makeModalPersistent,
        makeModalCloseable,
        validatePlayerName,
        validateGameName,
        saveToLocalStorage,
        loadFromLocalStorage,
        getGameIdFromUrl,
        hexToRgb,
        rgbToHex,
        lightenColor,
        darkenColor,
        distance,
        clamp,
        lerp,
        shuffle,
        groupBy,
        playSound,
        animate,
        debounce,
        throttle
    };
}