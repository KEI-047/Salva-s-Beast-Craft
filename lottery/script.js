const GAMES = {
  loto6: {
    label: "ロト6",
    max: 43,
    mainCount: 6,
    bonusCount: 0,
    rule: "1〜43の数字から6個を選びます。",
  },
  loto7: {
    label: "ロト7",
    max: 37,
    mainCount: 7,
    bonusCount: 2,
    rule: "1〜37の数字から7個（本数字）+ 2個（ボーナス数字）を選びます。",
  },
};

let currentGame = "loto6";

function pickRandomNumbers(max, count, excluded = []) {
  const pool = [];
  for (let n = 1; n <= max; n++) {
    if (!excluded.includes(n)) pool.push(n);
  }
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked.sort((a, b) => a - b);
}

function renderBalls(numbers, isBonus = false) {
  return numbers
    .map((n) => `<span class="ball${isBonus ? " bonus" : ""}">${n}</span>`)
    .join("");
}

function generateSets() {
  const game = GAMES[currentGame];
  const setsCount = Number(document.getElementById("sets-select").value);
  const resultsEl = document.getElementById("results");
  resultsEl.innerHTML = "";

  for (let i = 1; i <= setsCount; i++) {
    const main = pickRandomNumbers(game.max, game.mainCount);
    const bonus =
      game.bonusCount > 0 ? pickRandomNumbers(game.max, game.bonusCount, main) : [];

    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML =
      `<span class="result-label">${i}組目</span>` +
      renderBalls(main) +
      (bonus.length ? renderBalls(bonus, true) : "");
    resultsEl.appendChild(row);
  }
}

function selectGame(game) {
  currentGame = game;
  document.querySelectorAll(".game-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.game === game);
  });
  document.getElementById("game-rule").textContent = GAMES[game].rule;
  document.getElementById("results").innerHTML = "";
}

document.querySelectorAll(".game-btn").forEach((btn) => {
  btn.addEventListener("click", () => selectGame(btn.dataset.game));
});

document.getElementById("generate-btn").addEventListener("click", generateSets);

selectGame(currentGame);
