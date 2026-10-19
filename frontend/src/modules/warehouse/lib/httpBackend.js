// Серверная часть склада через API хаба (бэкенд + база DigitalOcean). Тот же набор функций, что в localBackend.js:
// store.js вызывает api(name, ...args) и не знает, что именно под ним. Включается, когда задан VITE_API_URL.
import { api } from '../../../core/api/index.js'

const base = '/modules/warehouse'
const enc = encodeURIComponent

export const httpBackend = {
  shared: true, // данные общие для всех ПК: доступны общая раскладка приёмки и защита кодов ЧЗ между компьютерами

  sync: (ops, worker) => api.post(`${base}/sync`, { ops, worker }),
  nextBoxCode: (box) => api.post(`${base}/box-code`, { category: String(box) }),
  assignPallet: (o) => api.post(`${base}/assign-pallet`, o),
  registerMark: (m) => api.post(`${base}/marks`, m),
  boxInfo: (code) => api.get(`${base}/boxes/${enc(code)}`),
  reopenBox: (code) => api.post(`${base}/boxes/${enc(code)}/reopen`),
  closeBoxRecord() {}, // короб записывается на сервере операцией sync «close»
  getBoxPallets: (codes) => api.post(`${base}/box-pallets`, { codes }),
  storageList: () => api.get(`${base}/storage`),
  freePallet: (code) => api.post(`${base}/pallets/${enc(code)}/free`),

  listSectors: () => api.get(`${base}/sectors`),
  addSector: (cat, sector, pin, known) => api.post(`${base}/sectors`, { cat: String(cat), sector: String(sector), pin, known: (known || []).map(String) }),
  removeSector: (cat, sector, pin) => api.post(`${base}/sectors/remove`, { cat: String(cat), sector: String(sector), pin }),
  importOld: (d, pin) => api.post(`${base}/import`, { data: d, pin }),

  listReceipts: () => api.get(`${base}/receipts`),
  createReceipt: (name) => api.post(`${base}/receipts`, { name }),
  finishReceipt: (name) => api.post(`${base}/receipts/finish`, { name }),

  savePlan: (receipt, json, name, worker) => api.post(`${base}/plan`, { receipt, json_data: json, name, worker }),
  getPlanInfo: (receipt) => api.get(`${base}/plan-info?receipt=${enc(receipt)}`),
  getPlan: (receipt) => api.get(`${base}/plan?receipt=${enc(receipt)}`),

  receiptState: (receipt, full) => api.get(`${base}/receipt-state?receipt=${enc(receipt)}${full ? '&full=true' : ''}`),
}
