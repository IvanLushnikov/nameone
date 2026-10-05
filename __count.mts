import { subjects } from "./src/lib/content/subjects";
import { MATERIALS_CATALOG } from "./src/lib/content/materials-catalog";
import { FORMAT_META } from "./src/lib/interactives/formats";
let topics=0, pairs=0;
for (const s of subjects){pairs+=s.grades.length; for(const g of s.grades) topics+=g.topics.length;}
console.log("subjects",subjects.length,"pairs",pairs,"topics",topics);
console.log("materials",MATERIALS_CATALOG.length);
console.log("formats",FORMAT_META.length);
