import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ========== Global Error Handlers ==========
// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', {
    message: event.reason?.message || String(event.reason),
    stack: event.reason?.stack,
    timestamp: new Date().toISOString()
  });
  
  // Prevent the error from being swallowed
  // In production, send to error monitoring service
  // Example: Sentry.captureException(event.reason);
});

// Catch global errors outside React tree
window.addEventListener('error', (event) => {
  console.error('[Global Error]', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack,
    timestamp: new Date().toISOString()
  });
  
  // In production, send to error monitoring service
  // Example: Sentry.captureException(event.error);
});

// ========== Performance Monitoring ==========
// Report Web Vitals (optional - requires firebase/perf or web-vitals package)
const reportWebVitals = (metric) => {
  if (process.env.NODE_ENV === 'production') {
    // Send to analytics
    console.log('[Web Vital]', metric.name, metric.value);
    
    // Example with Firebase Performance Monitoring:
    // import { getPerformance, trace } from 'firebase/performance';
    // const perf = getPerformance();
    // const perfTrace = trace(perf, metric.name);
    // perfTrace.start();
    // perfTrace.putMetric('value', metric.value);
    // perfTrace.stop();
  }
};

// ========== Render App ==========
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(
    'Root element not found. Make sure there is a <div id="root"></div> in your index.html.'
  );
}

const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ========== Service Worker Registration (Optional PWA) ==========
// Uncomment to enable offline support
// if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/service-worker.js')
//       .then(registration => {
//         console.log('Service Worker registered:', registration.scope);
//       })
//       .catch(error => {
//         console.error('Service Worker registration failed:', error);
//       });
//   });
// }

// ========== Development Helpers ==========
if (process.env.NODE_ENV === 'development') {
  // Log app version
  console.log(`🚀 Nexdray TMS - Development Mode`);
  console.log(`📦 Build: ${new Date().toLocaleString()}`);
  
  // Expose app for debugging (remove in production)
  // window.__APP__ = app;
}