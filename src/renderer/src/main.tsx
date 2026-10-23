import { createRoot } from 'react-dom/client'
import { Overlay } from './overlay/Overlay'
import './styles.css'

// One renderer bundle, several views selected by the URL hash.
const views: Record<string, () => JSX.Element> = {
  overlay: () => <Overlay />
}

const view = views[location.hash.slice(1)] ?? views.overlay
createRoot(document.getElementById('root')!).render(view())
