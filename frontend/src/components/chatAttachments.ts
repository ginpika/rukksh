const imageExtensions = ['png', 'jpg', 'jpeg', 'gif']
const documentExtensions = ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv']
const extensions = [...imageExtensions, ...documentExtensions]

export const chatAttachmentAccept = extensions.map(ext => '.' + ext).join(',')
export const chatAttachmentFormats = 'PNG、JPEG、GIF、PDF、DOCX、TXT、Markdown、CSV'
export const chatAttachmentMaxFiles = 4

function extension(name: string) {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

export function chatAttachmentInfo(file: File) {
  return { name: file.name, image: imageExtensions.includes(extension(file.name)) }
}

export function chatAttachmentSelectionError(files: File[]): string | null {
  const unsupported = files.find(file => file.name.lastIndexOf('.') <= 0 || !extensions.includes(extension(file.name)))
  if (unsupported) return '不支持的附件格式：' + unsupported.name
  const empty = files.find(file => !file.size)
  if (empty) return '文件为空：' + empty.name
  if (files.length > chatAttachmentMaxFiles) return '每条消息最多可添加 4 个附件'
  if (files.filter(file => chatAttachmentInfo(file).image).length > 2) return '每条消息最多可添加 2 张图片'
  if (files.reduce((bytes, file) => bytes + file.size, 0) > 4 * 1024 * 1024) return '附件总大小不能超过 4 MB'
  return null
}
