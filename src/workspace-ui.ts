import './workspace.css';

const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
function showView(id: string) {
  if (!controls.some(button => button.dataset.view === id)) id = 'observation';
  for (const panel of document.querySelectorAll<HTMLElement>('.workspace-view')) panel.hidden = panel.id !== id;
  for (const button of controls) {
    if (button.dataset.view === id) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('workspace-view'));
  window.scrollTo({top: 0, behavior: 'instant'});
}
for (const button of controls) button.onclick = () => {
  history.replaceState(null, '', '#' + button.dataset.view);
  showView(button.dataset.view!);
};
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
showView(location.hash.slice(1));
const inspector = document.getElementById('inspector') as HTMLDetailsElement;
const selected = document.getElementById('selected-name')!;
let lastName = selected.textContent;
new MutationObserver(() => {
  if (selected.textContent !== lastName) inspector.open = true;
  lastName = selected.textContent;
}).observe(selected, {childList: true, characterData: true, subtree: true});
