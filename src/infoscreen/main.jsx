import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Infoscreen from './Infoscreen.jsx'
import './infoscreen.css'

createRoot(document.getElementById('infoscreen-root')).render(
  <StrictMode>
    <Infoscreen />
  </StrictMode>
)
