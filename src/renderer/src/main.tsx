import './polyfills'
import '@fontsource-variable/inter'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/buttons.css'
import './styles/layout.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { COURSE_CSS } from '@shared/course-css'

// Mise en page « cours » des fiches (la même feuille sert à l'écran et à l'export PDF).
const courseStyle = document.createElement('style')
courseStyle.id = 'course-css'
courseStyle.textContent = COURSE_CSS
document.head.appendChild(courseStyle)

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
