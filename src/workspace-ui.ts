import './workspace.css';

const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
function jumpToSection(id: string, scroll = true) {
  if (!controls.some(button => button.dataset.view === id)) id = 'observation';
  for (const button of controls) {
    if (button.dataset.view === id) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  }
  window.dispatchEvent(new Event('workspace-view'));
  if (scroll) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
for (const button of controls) button.onclick = () => {
  history.replaceState(null, '', '#' + button.dataset.view);
  jumpToSection(button.dataset.view!);
};
window.addEventListener('hashchange', () => jumpToSection(location.hash.slice(1)));
jumpToSection(location.hash.slice(1), !!location.hash);
const inspector = document.getElementById('inspector') as HTMLDetailsElement;
const selected = document.getElementById('selected-name')!;
let lastName = selected.textContent;
new MutationObserver(() => {
  if (selected.textContent !== lastName) inspector.open = true;
  lastName = selected.textContent;
}).observe(selected, {childList: true, characterData: true, subtree: true});
