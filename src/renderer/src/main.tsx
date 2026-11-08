import './polyfills'
import '@fontsource-variable/inter'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './styles/tokens.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
