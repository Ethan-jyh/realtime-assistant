import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './theme.css';
import { WorkspacePage } from './pages/Workspace';
import { OverlayPage } from './pages/Overlay';
import { CapturePage } from './pages/Capture';

export function App(): React.JSX.Element {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if(route.includes('capture'))return <CapturePage/>;
  if (route.includes('overlay')) {
    return <OverlayPage />;
  }
  return <WorkspacePage />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
