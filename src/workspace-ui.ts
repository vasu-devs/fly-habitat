import './workspace.css';

// Navigation follows the visible section; anchor links work without scripting.
const links = [...document.querySelectorAll<HTMLAnchorElement>('.workspace-nav a')];
const sections = links.map(link => document.querySelector(link.hash)!);
const updateSection = () => {
  let current = 0;
  sections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= 100) current = index;
  });
  links.forEach((link, index) => {
    if (index === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
};
addEventListener('scroll', updateSection, { passive: true });
updateSection();

// Reveal the existing intervention controls when a cell is selected.
const selected = document.getElementById('selected-name')!;
const inspector = document.getElementById('inspector') as HTMLDetailsElement;
let lastName = selected.textContent;
new MutationObserver(() => {
  if (selected.textContent !== lastName) inspector.open = true;
  lastName = selected.textContent;
}).observe(selected, { childList: true, characterData: true, subtree: true });
