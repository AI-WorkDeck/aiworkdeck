import crypto from 'crypto'
import { memoryUsage } from 'process'
import { Request, Response, NextFunction } from 'express'
import { formatFileSize } from '.'
import { logger } from './logger'

interface Options {
  prefix?: string
  length?: number
}
interface TaskManagerOptions {
  length?: number
}
export interface Task {
  id: string
  fields: any
  status: string
  progress: number
  message: string
  code?: string | number
  result: any
  createdAt: Date
  updatedAt?: Date
  updateProgress?: (taskId: string, progress: number) => Task | undefined
  endTask?: (taskId: string) => void
  context?: {
    req?: Request
    res?: Response
    body?: any
    result?: TTSResult
    segment?: Segment
    lang?: string
    voiceList?: VoiceConfig[]
  }
}
class TaskManager {
  tasks: Map<string, Task>
  MAX_TASKS: number
  constructor(options?: TaskManagerOptions) {
    this.tasks = new Map()
    this.MAX_TASKS = options?.length || 10
  }

  generateTaskId(fields: any, options: Options = {}) {
    const { prefix = 'task', length = 32 } = options
    const hash = crypto.createHash('md5')

    Object.keys(fields)
      .sort()
      .forEach((key) => {
        const value = fields[key]
        if (!value) return
        hash.update(key)
        if (typeof value === 'string' && value.length > 1000) {
          for (let i = 0; i < value.length; i += 1000) {
            hash.update(value.slice(i, i + 1000))
          }
        } else {
          hash.update(JSON.stringify(value))
        }
      })

    const hashValue = hash.digest('hex')
    return `${prefix}${hashValue.slice(0, length)}`
  }

  createTask(fields: any, options?: Options): Task {
    const taskId = this.generateTaskId(fields, options)
    if (this.isTaskPending(taskId)) {
      throw new Error(`task: ${taskId} already exists!`)
    }
    if (this.getPendingTasks()?.length >= this.MAX_TASKS) {
      throw new Error(`Cannot create more than ${this.MAX_TASKS} tasks!`)
    }
    const task = {
      id: taskId,
      fields,
      status: 'pending',
      progress: 0,
      message: '',
      result: null,
      createdAt: new Date(),
      updateProgress: this.updateProgress.bind(this),
      endTask: this.finishTask.bind(this),
    }
    this.tasks.set(taskId, task)
    return task
  }

  finishTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Cannot find task: ${taskId}`)
    task.status = 'completed'
    task.progress = 100
    task.updatedAt = new Date()
    this.tasks.set(taskId, task)
    logger.info(`Task ${taskId} completed`)
    return task
  }
  isTaskPending(taskId: string) {
    return this.getTask(taskId)?.status === 'pending' || false
  }
  getTask(taskId: string) {
    return this.tasks.get(taskId) || null
  }
  failTask(taskId: string, { code, message }: { code?: number; message: string }) {
    const findTask = this.getTask(taskId)
    if (!findTask) {
      throw new Error(`Cannot find task: ${taskId}`)
    }
    findTask.status = 'failed'
    findTask.message = message
    findTask.code = code
    findTask.updatedAt = new Date()
    this.tasks.set(taskId, findTask)
    return true
  }
  updateProgress(taskId: string, progress: number): Task | undefined {
    const findTask = this.getTask(taskId)
    if (!findTask) return
    findTask.progress = progress
    findTask.updatedAt = new Date()
    this.tasks.set(taskId, findTask)
    return findTask
  }
  updateTask(
    taskId: string,
    {
      status = 'completed',
      progress = 100,
      result,
    }: { status?: string; progress?: number; result: any }
  ) {
    const findTask = this.getTask(taskId)
    if (!findTask) {
      throw new Error(`Cannot find task: ${taskId}`)
    }
    findTask.status = status
    findTask.updatedAt = new Date()
    findTask.progress = progress
    findTask.result = result
    this.tasks.set(taskId, findTask)
    return findTask
  }
  getTaskLength() {
    return this.tasks.size
  }
  getPendingTasks() {
    return Array.from(this.tasks.values()).filter((task) => task.status === 'pending')
  }
  getTaskStats() {
    const tasks = Array.from(this.tasks.values())
    const memory = {
      heapUsed: formatFileSize(memoryUsage().heapUsed),
      heapTotal: formatFileSize(memoryUsage().heapTotal),
      rss: formatFileSize(memoryUsage().rss),
    }
    const stats = {
      totalTasks: this.getTaskLength(),
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      pendingTasks: tasks.filter((task) => task.status === 'pending').length,
      memory,
    }
    return stats
  }
}
const instance = new TaskManager()
export default instance
