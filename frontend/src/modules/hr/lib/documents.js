// Правила документов сотрудника (контракт: docs/TZ-hr-dossier.md, документы). Общие для UI и mock.
export const DOC_CATEGORIES = ['contract', 'order', 'id_doc', 'tax', 'bank', 'medical', 'other']
export const DOC_MAX_BYTES = 8 * 1024 * 1024
export const DOC_MAX_COUNT = 50
export const DOC_TITLE_LIMIT = 200

export const DOC_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}
export const DOC_EXTENSIONS = Object.keys(DOC_MIME)
