import { Component } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeModeProvider } from './context/ThemeModeContext';
import { AuthProvider } from './context/AuthContext';
import AppRoutes from './routes/AppRoutes';

// Safety net for the LOCAL MODE transition (Firebase integration lands in
// Milestone 3). Guarantees the app never falls back to a blank white
// screen — existing layouts, routing, and pages are untouched.
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled application error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h1>Something went wrong</h1>
          <p>Please refresh the page. Running in LOCAL MODE — Firebase integration lands in Milestone 3.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ThemeModeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ThemeModeProvider>
    </AppErrorBoundary>
  );
}
