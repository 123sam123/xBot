import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../common/base.css';
import './styles.css';
import { applyMaterialFromLocation } from '../design-system';
import { App } from './App';

applyMaterialFromLocation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
