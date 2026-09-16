export const $ = id => document.getElementById(id);
export const onLeave = [];   // 화면을 떠날 때 호출할 함수들
export function show(name) {
  onLeave.forEach(f => f());
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== name; });
  window.scrollTo(0, 0);
}
