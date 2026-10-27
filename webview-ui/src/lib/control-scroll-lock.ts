/** Keep the current panel/popover position while a pointer scrubs a value. */
export function lockControlScroll(control: HTMLElement): () => void {
  const document = control.ownerDocument;
  const ancestors: HTMLElement[] = [];
  for (let node = control.parentElement; node; node = node.parentElement) ancestors.push(node);
  const root = document.scrollingElement as HTMLElement | null;
  if (root && !ancestors.includes(root)) ancestors.push(root);
  const positions = ancestors.map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  let restoring = false, released = false;
  const restore = () => {
    if (restoring || released) return;
    restoring = true;
    for (const { element, top, left } of positions) {
      if (element.scrollTop !== top) element.scrollTop = top;
      if (element.scrollLeft !== left) element.scrollLeft = left;
    }
    restoring = false;
  };
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  for (const { element } of positions) element.addEventListener('scroll', restore);
  const options={capture:true,passive:false};
  document.addEventListener('wheel', prevent, options);
  document.addEventListener('touchmove', prevent, options);
  return () => {
    if (released) return;
    restore();
    released = true;
    for (const { element } of positions) element.removeEventListener('scroll', restore);
    document.removeEventListener('wheel', prevent, options);
    document.removeEventListener('touchmove', prevent, options);
  };
}
