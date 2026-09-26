import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './lib/store'
import { DEMO } from './lib/supabase'
import './styles.css'

// No modo demonstração (arquivo único, aberto localmente) usamos rotas com "#".
const Router = DEMO ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AppProvider>
        <App />
      </AppProvider>
    </Router>
  </React.StrictMode>
)
