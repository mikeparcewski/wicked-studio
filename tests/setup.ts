import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView — stub it only when missing.
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
