import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import './i18n'
import { cleanupLargeData, migrateFromLocalStorage } from './lib/indexed-db'

// Hide splash screen when React is ready
const hideSplash = () => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        splash.classList.add('fade-out')
        setTimeout(() => splash.remove(), 500)
    }
}

// Start app only after migrations complete
async function startApp() {
    // CRITICAL: Migration must complete BEFORE React renders
    // Otherwise Zustand stores will hydrate from empty IndexedDB
    
    // Migrate localStorage to IndexedDB for stores that changed storage backend
    await migrateFromLocalStorage([
        'nais2-presets',
        'nais2-character-prompts', 
        'nais2-settings',
        'nais2-auth'
    ])
    console.log('[Startup] LocalStorage migration complete')

    // Cleanup large wildcard data (non-critical, can be async)
    cleanupLargeData('nais2-wildcards', 100).then((cleaned) => {
        if (cleaned) {
            console.log('[Startup] Large wildcard data was cleaned up')
        }
    })

    // NOW render React app
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )

    // Delay slightly to ensure app renders, then hide splash
    requestAnimationFrame(() => {
        requestAnimationFrame(hideSplash)
    })
}

startApp()

// Delay slightly to ensure app renders, then hide splash
requestAnimationFrame(() => {
    requestAnimationFrame(hideSplash)
})
