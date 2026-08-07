(function () {
  function createToastContainer() {
    let container = document.getElementById('toast-container');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
  }

  function createToastElement(message, type, duration) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');

    const text = document.createElement('div');
    text.className = 'toast-message';
    text.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.className = 'toast-close';
    closeButton.setAttribute('type', 'button');
    closeButton.setAttribute('aria-label', 'Close notification');
    closeButton.textContent = '×';

    closeButton.addEventListener('click', () => {
      removeToast(toast);
    });

    toast.appendChild(text);
    toast.appendChild(closeButton);

    const container = createToastContainer();
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const timeout = window.setTimeout(() => {
      removeToast(toast);
    }, duration);

    toast._toastTimeout = timeout;
    return toast;
  }

  function removeToast(toast) {
    if (!toast || toast.classList.contains('removing')) return;

    toast.classList.add('removing');
    if (toast._toastTimeout) {
      clearTimeout(toast._toastTimeout);
    }

    window.setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 220);
  }

  window.showToast = function showToast(message, type, duration) {
    const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 3000;
    createToastElement(message, safeType, safeDuration);
  };
})();
