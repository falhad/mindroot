import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, X } from 'lucide-react'
import { downloads, installSteps, OS_NAMES, primaryDownload, RELEASES_URL, type Arch, type DesktopOs } from '../core/download'
import { APP_VERSION, latestReleaseVersion, visitorArch, visitorOs } from '../io/release'
import { ui, useUi } from '../state/ui'
import { Modal } from './Overlays'

const TABS: DesktopOs[] = ['mac', 'windows', 'linux']

/** Web version only: the installer for this computer, the other installers, and how to install an unsigned app. */
export function DownloadDialog() {
  const open = useUi((s) => s.downloadOpen)
  if (!open) return null
  return <DownloadBody />
}

function DownloadBody() {
  const close = () => ui.setDownload(false)
  const known = visitorOs === 'mac' || visitorOs === 'windows' || visitorOs === 'linux'
  const [tab, setTab] = useState<DesktopOs>(known ? (visitorOs as DesktopOs) : 'mac')
  const [arch, setArch] = useState<Arch>('unknown')
  const [version, setVersion] = useState(APP_VERSION)
  useEffect(() => {
    let live = true
    void visitorArch().then((a) => live && setArch(a))
    void latestReleaseVersion().then((v) => live && setVersion(v))
    return () => { live = false }
  }, [])

  const list = useMemo(() => downloads(version), [version])
  // The large button is for this computer. On the tab of another system, the first file of that system leads.
  const main = tab === visitorOs ? primaryDownload(list, visitorOs, arch) : null
  const files = list.filter((d) => d.os === tab)
  const others = main ? files.filter((d) => d.id !== main.id) : files
  const noBuild = tab === visitorOs && !main // Linux on ARM

  return (
    <Modal onClose={close} label="Download the desktop app" width={600} top="7vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">Get Mindroot for your desktop</h2>
          <p className="text-[12.5px] text-muted">Version {version} · free and open source</p>
        </div>
        <button className="btn icon" aria-label="Close" onClick={close}><X size={16} /></button>
      </div>

      <div className="max-h-[74vh] overflow-y-auto p-5">
        <p className="mb-4 text-[13px] text-muted" style={{ textWrap: 'pretty' }}>
          The desktop app keeps your maps as plain files on your disk. It adds Git sync, quick capture from any app, and an AI assistant that works with all services.
        </p>

        <div className="seg mb-4" role="tablist" aria-label="Operating system">
          {TABS.map((os) => (
            <button key={os} role="tab" aria-selected={tab === os} className={tab === os ? 'on' : ''} onClick={() => setTab(os)}>
              {OS_NAMES[os]}{os === visitorOs ? ' · this computer' : ''}
            </button>
          ))}
        </div>

        {!known && tab === 'mac' && (
          <p className="mb-3 text-[12.5px] text-muted" data-testid="download-unknown">
            {visitorOs === 'mobile'
              ? 'Mindroot has no phone or tablet app yet. Open this page on a computer to install it, or get a file here for later.'
              : 'There is no installer for this system. Choose a system above if you want a file for a different computer.'}
          </p>
        )}

        {main && (
          <a className="btn primary mb-2 w-full justify-center" style={{ height: 46, fontSize: 14 }} href={main.url} download data-testid="download-main">
            <Download size={17} /> Download for {OS_NAMES[main.os]} <span className="opacity-80">· {main.label}</span>
          </a>
        )}
        {main && <p className="mb-3 text-center text-[12px] text-muted">{main.file}</p>}
        {noBuild && (
          <p className="mb-3 text-[12.5px] text-muted" data-testid="download-nobuild">
            There is no build for Linux on ARM yet. The files below are for x86-64 computers. You can also build the app from source.
          </p>
        )}

        <div className="mb-5 space-y-1.5" aria-label={`${main ? 'Other files' : 'Files'} for ${OS_NAMES[tab]}`} role="group">
          {main && others.length > 0 && <div className="label mb-1.5">Other files for {OS_NAMES[tab]}</div>}
          {others.map((d) => (
            <a key={d.id} href={d.url} download data-testid={`download-${d.id}`}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-[13px] transition-colors hover:bg-hover">
              <Download size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.label}</span>
                <span className="block truncate text-[12px] text-muted">{d.detail}</span>
              </span>
            </a>
          ))}
        </div>

        <div className="label mb-2">How to install on {OS_NAMES[tab]}</div>
        <ol className="space-y-2.5 text-[13px]" data-testid="install-steps">
          {installSteps(tab).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hover text-[11px] font-semibold text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <span style={{ textWrap: 'pretty' }}>{s.text}</span>
                {s.code && <CodeLine code={s.code} />}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12.5px] text-muted" style={{ textWrap: 'pretty' }}>
          Why the warning? A signing certificate costs money each year, and this project has none yet. The code is open, and each installer is built from it by GitHub.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-[12.5px] text-muted">
        <span>Your maps in this browser stay here. Export them to move them to the app.</span>
        <a className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline" href={RELEASES_URL} target="_blank" rel="noreferrer">
          All files and notes <ExternalLink size={12} />
        </a>
      </div>
    </Modal>
  )
}

function CodeLine({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* no clipboard access: the user selects the text */ }
  }
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-hover py-1 pl-2.5 pr-1">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px]" dir="ltr">{code}</code>
      <button className="btn icon shrink-0" style={{ width: 26, height: 26 }} aria-label={copied ? 'Copied' : 'Copy the command'} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}
