import {rectangleDiameterRange,outlineYRecipe} from './rectangles.ts';
import type {RectangleRecipe} from './rectangles.ts';

export type PrinterEnvelope={x:number;y:number};
export const defaultPrinterEnvelope:PrinterEnvelope={x:300,y:300};
const key='contour-lab-printer-envelope';
export function parsePrinterEnvelope(value:unknown):PrinterEnvelope {
 const p=value as PrinterEnvelope;
 if(!p||![p.x,p.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))throw new Error('Printer X and Y must be positive measurements in millimetres.');
 return {x:p.x,y:p.y};
}
export function printerEnvelope():PrinterEnvelope {
 try{return parsePrinterEnvelope(JSON.parse(localStorage.getItem(key)||'null'));}catch{return {...defaultPrinterEnvelope};}
}
export function savePrinterEnvelope(value:unknown) {
 const p=parsePrinterEnvelope(value);localStorage.setItem(key,JSON.stringify(p));return p;
}
const fmt=(n:number)=>String(Number(n.toFixed(2)));
export function printerShapeError(r:RectangleRecipe,p=printerEnvelope()):string|undefined {
 for(const [axis,profile] of [['x',r],['y',outlineYRecipe(r)]] as const){
  const range=rectangleDiameterRange(profile);
  if(range.max>p[axis]+1e-8)return `The ${axis.toUpperCase()} spline reaches ${fmt(range.max)} mm, above your printer's ${fmt(p[axis])} mm ${axis.toUpperCase()} limit. Reduce the level sizes or soften the size changes, or change Printer settings.`;
 }
}
export function printerFootprintError(bounds:{min:{x:number;y:number};max:{x:number;y:number}},p=printerEnvelope()):string|undefined {
 const x=bounds.max.x-bounds.min.x,y=bounds.max.y-bounds.min.y;
 if(x>p.x+1e-4||y>p.y+1e-4)return `The finished footprint is ${fmt(x)} × ${fmt(y)} mm, exceeding your printer's ${fmt(p.x)} × ${fmt(p.y)} mm X/Y envelope. Reduce the shape, strand sizes or centre offsets, or change Printer settings.`;
}
