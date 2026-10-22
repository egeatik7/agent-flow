import { createContext } from 'react'
import type { FileFolder } from '../../electron/file-contract'
export const FileValuesContext = createContext<{ values: Record<string, string>; folders: FileFolder[] }>({ values: {}, folders: [] })
