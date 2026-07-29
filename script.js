const PREFIXES = ["Fire", "Shadow", "Crystal", "Storm", "Ancient", "Lunar", "Iron", "Venom"];
const CREATURES = [
  { name: "Wyrm", emoji: "🐉" },
  { name: "Griffin", emoji: "🦅" },
  { name: "Kraken", emoji: "🐙" },
  { name: "Wolf", emoji: "🐺" },
  { name: "Phoenix", emoji: "🔥" },
  { name: "Golem", emoji: "🗿" },
  { name: "Serpent", emoji: "🐍" },
  { name: "Bat", emoji: "🦇" },
];
const ELEMENTS = ["Fire", "Water", "Earth", "Wind", "Light", "Dark"];

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomStat(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function craftBeast() {
  const prefix = randomItem(PREFIXES);
  const creature = randomItem(CREATURES);
  const element = randomItem(ELEMENTS);

  document.getElementById("beast-emoji").textContent = creature.emoji;
  document.getElementById("beast-name").textContent = `${prefix} ${creature.name}`;
  document.getElementById("stat-atk").textContent = randomStat(10, 99);
  document.getElementById("stat-def").textContent = randomStat(10, 99);
  document.getElementById("stat-spd").textContent = randomStat(10, 99);
  document.getElementById("beast-element").textContent = `属性: ${element}`;

  document.getElementById("beast-card").classList.remove("hidden");
}

document.getElementById("craft-btn").addEventListener("click", craftBeast);
