import { DAYS, DISH_TYPES, MENU_TYPES } from "./config.js";

const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function parseQuery(q) {
  return q
    .split("+")
    .map((part) => part.split(/\s+/).map(fold).filter(Boolean))
    .filter((group) => group.length > 0);
}

export function searchDishes(dishes, f = {}) {
  const groups = parseQuery(f.q || "");

  return dishes.filter((d) => {
    if (f.maxPrice && (d.price === null || d.price > f.maxPrice)) return false;
    if (f.vegan && !d.vegan) return false;
    if (f.vegetarian && !d.vegetarian) return false;
    if (f.menuType && d.menuType !== f.menuType) return false;
    if (f.dishType && d.dishType !== f.dishType) return false;
    if (f.day && !d.open.some((seg) => seg.days.includes(f.day))) return false;

    if (groups.length) {
      const text = fold(`${d.name} ${d.description} ${d.venue} ${d.nation}`);
      const matchesEveryGroup = groups.every((group) => group.some((word) => text.includes(word)));
      if (!matchesEveryGroup) return false;
    }
    return true;
  });
}