import { createRoot } from 'react-dom/client'
import { Overlay } from './overlay/Overlay'
import { Pin } from './pin/Pin'
import { Thumb } from './pin/Thumb'
import { Settings } from './settings/Settings'
import { History } from './history/History'
import { applyTheme } from './theme'
import './styles.css'

// Every open window follows theme changes right away.
window.snapkit.onAppearance(applyTheme)

// One renderer bundle, several views selected by the URL hash.
const views: Record<string, () => JSX.Element> = {
  overlay: () => <Overlay />,
  pin: () => <Pin />,
  thumb: () => <Thumb />,
  settings: () => <Settings />,
  history: () => <History />
}

const view = views[location.hash.slice(1)] ?? views.overlay
createRoot(document.getElementById('root')!).render(view())
