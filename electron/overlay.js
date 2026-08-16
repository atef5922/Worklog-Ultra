const root = document.getElementById("root");
let queue = [];

function render() {
  const item = queue[0];
  if (!item) { root.innerHTML = ""; return; }
  root.innerHTML = `<div class="card"><div class="head"><span>WorkLog Screenshot</span><span class="count">${queue.length} pending</span></div><img class="shot" src="${item.dataUrl}" alt="Desktop screenshot"><div class="meta"><strong>${item.label}</strong><br>${new Date(item.capturedAt).toLocaleString()}</div><div class="actions"><button class="edit" data-action="edit">Edit</button><button class="discard" data-action="discard">Cross</button><button class="submit" data-action="submit">Submit</button></div></div>`;
  root.querySelectorAll("button").forEach((button) => button.addEventListener("click", async () => {
    await window.worklogOverlay.action(button.dataset.action, item.id);
  }));
}

window.worklogOverlay.onQueue((items) => { queue = items; render(); });
