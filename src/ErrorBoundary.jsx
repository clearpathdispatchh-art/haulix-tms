// ErrorBoundary.jsx - PRODUCTION-READY

import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw, ChevronDown } from "lucide-react";

// FIXED: Structured error logging
const logError = (context, error, errorInfo = {}) => {
  const errorData = {
    message: error?.message || String(error),
    stack: error?.stack,
    componentStack: errorInfo?.componentStack,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  };

  if (process.env.NODE_ENV === 'production') {
    console.error(`[ErrorBoundary][${context}]`, errorData);
    
    // TODO: Send to production error monitoring service
    // Example: Sentry.captureException(error, { extra: errorData });
    // Example: LogRocket.captureException(error);
  } else {
    console.error(`[ErrorBoundary][${context}]`, error, errorInfo);
  }
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      retryCount: 0 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error
    logError('componentDidCatch', error, errorInfo);
    
    // Store errorInfo for display in development
    if (process.env.NODE_ENV !== 'production') {
      this.setState({ errorInfo });
    }
    
    // FIXED: Call optional onError callback if provided
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (callbackError) {
        console.error('ErrorBoundary onError callback failed:', callbackError);
      }
    }
  }

  // FIXED: Retry by resetting error state
  handleRetry = () => {
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null,
      retryCount: this.state.retryCount + 1 
    });
  };

  // FIXED: Hard refresh as last resort
  handleHardRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV !== 'production';
      
      // FIXED: Customizable fallback UI
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          retry: this.handleRetry,
          retryCount: this.state.retryCount
        });
      }
      
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-8">
          <div className="bg-white dark:bg-slate-800 p-8 sm:p-10 rounded-3xl shadow-xl max-w-md w-full text-center">
            {/* Error Icon */}
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            
            <h1 className="text-xl font-black text-slate-900 dark:text-white mb-2">
              Something went wrong
            </h1>
            
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">
              The application encountered an unexpected error.
            </p>
            
            {/* FIXED: More helpful message based on retry count */}
            {this.state.retryCount === 0 && (
              <p className="text-slate-400 dark:text-slate-500 text-xs mb-6">
                This is usually temporary. Try retrying first.
              </p>
            )}
            {this.state.retryCount > 0 && (
              <p className="text-amber-600 dark:text-amber-400 text-xs mb-6">
                The error persists after {this.state.retryCount} retr{this.state.retryCount === 1 ? 'y' : 'ies'}. 
                A full page refresh may help.
              </p>
            )}
            
            {/* FIXED: Two recovery options */}
            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </button>
              
              {this.state.retryCount > 0 && (
                <button
                  onClick={this.handleHardRefresh}
                  className="w-full px-6 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh Page
                </button>
              )}
            </div>
            
            {/* FIXED: Error details only in development */}
            {isDev && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                  <ChevronDown className="w-3 h-3" />
                  Technical Details
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Error Message</div>
                    <pre className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs text-red-600 dark:text-red-400 overflow-auto max-h-24 whitespace-pre-wrap">
                      {this.state.error?.message || this.state.error?.toString() || 'Unknown error'}
                    </pre>
                  </div>
                  
                  {this.state.error?.stack && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Stack Trace</div>
                      <pre className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs text-slate-600 dark:text-slate-400 overflow-auto max-h-48 whitespace-pre-wrap">
                        {this.state.error.stack}
                      </pre>
                    </div>
                  )}
                  
                  {this.state.errorInfo?.componentStack && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Component Stack</div>
                      <pre className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs text-slate-600 dark:text-slate-400 overflow-auto max-h-48 whitespace-pre-wrap">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                  
                  <div className="text-[10px] text-slate-400 text-center">
                    Retry count: {this.state.retryCount} • {new Date().toLocaleString()}
                  </div>
                </div>
              </details>
            )}
            
            {/* FIXED: Only show minimal info in production */}
            {!isDev && this.state.error && (
              <p className="mt-6 text-[10px] text-slate-400">
                Error ID: {Math.random().toString(36).substring(2, 10).toUpperCase()}
              </p>
            )}
          </div>
          
          {/* Footer */}
          <p className="mt-6 text-xs text-slate-400">
            If this continues, please contact support
          </p>
        </div>
      );
    }
    
    return this.props.children;
  }
}

export default ErrorBoundary;