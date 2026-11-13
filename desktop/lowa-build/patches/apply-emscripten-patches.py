#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Backport an upstream Emscripten proxying deadlock fix into the allotropia fork.

Usage: apply-emscripten-patches.py <emscripten-fork-dir>

Why (O9, 2026-11-13): the engine occasionally hung right after boot. Native samples
of the hung renderer showed the main thread inside `do_proxy` holding the system
proxying queue mutex while `get_or_add_tasks_for_thread` called realloc/malloc;
malloc waited, the main-thread wait loop executed queued calls, and
`emscripten_proxy_execute_queue` tried to lock the same mutex -> deadlock (other
threads proxying `mkdir` and `devicePixelRatio` to the main thread then queue up
behind it). Upstream fixed exactly this in emscripten-core/emscripten#28186
("[Proxying] Do not allocate while holding mutex", 2026-11-11; earlier partial fix
#24565). The fork pinned in mega-build.sh (fixed-3.1.65) predates both, and the
upstream diff does not apply mechanically, so this script swaps in the upstream
versions of the two functions. Upstream code: MIT / University of Illinois NCSA,
Copyright 2021 The Emscripten Authors (see UPSTREAM.md).

Idempotent; exits non-zero if an anchor is missing so the build stops loudly.
"""
import sys
from pathlib import Path

MARK = '/* awd: proxying no-alloc-under-lock (emscripten#28186 backport) */'

OLD_GET_OR_ADD = '''// Not thread safe.
static em_task_queue* get_or_add_tasks_for_thread(em_proxying_queue* q,
                                                  pthread_t thread) {
  em_task_queue* tasks = get_tasks_for_thread(q, thread);
  if (tasks != NULL) {
    return tasks;
  }
  // There were no tasks for the thread; initialize a new em_task_queue. If
  // there are not enough queues, allocate more.
  if (q->size == q->capacity) {
    int new_capacity = q->capacity == 0 ? 1 : q->capacity * 2;
    em_task_queue** new_task_queues =
      realloc(q->task_queues, sizeof(em_task_queue*) * new_capacity);
    if (new_task_queues == NULL) {
      return NULL;
    }
    q->task_queues = new_task_queues;
    q->capacity = new_capacity;
  }
  // Initialize the next available task queue.
  tasks = em_task_queue_create(thread);
  if (tasks == NULL) {
    return NULL;
  }
  q->task_queues[q->size++] = tasks;
  return tasks;
}'''

NEW_GET_OR_ADD = MARK + '''
// Takes and releases q->mutex itself; never allocates or frees while holding it.
static em_task_queue* get_or_add_tasks_for_thread(em_proxying_queue* q,
                                                  pthread_t thread) {
  pthread_mutex_lock(&q->mutex);
  em_task_queue* tasks = get_tasks_for_thread(q, thread);
  pthread_mutex_unlock(&q->mutex);
  if (tasks != NULL) {
    return tasks;
  }

  // There were no tasks for the thread; initialize a new em_task_queue outside
  // the lock so allocations cannot deadlock with queue execution.
  em_task_queue* new_tasks = em_task_queue_create(thread);
  if (new_tasks == NULL) {
    return NULL;
  }

  // Holds the newly allocated task_queues array before it is installed, or the
  // old task_queues array after they are swapped so it can be freed outside
  // the lock.
  em_task_queue** queues_to_free = NULL;
  pthread_mutex_lock(&q->mutex);
  while (true) {
    // Re-check in case another thread added the queue while unlocked.
    tasks = get_tasks_for_thread(q, thread);
    if (tasks != NULL) {
      pthread_mutex_unlock(&q->mutex);
      goto out;
    }
    if (q->size < q->capacity) {
      break;
    }
    // There is not capacity for more queues; reallocate outside the lock.
    int new_capacity = q->capacity == 0 ? 1 : q->capacity * 2;
    pthread_mutex_unlock(&q->mutex);
    em_task_queue** new_task_queues =
      realloc(queues_to_free, sizeof(em_task_queue*) * new_capacity);
    if (new_task_queues == NULL) {
      goto out;
    }
    queues_to_free = new_task_queues;
    pthread_mutex_lock(&q->mutex);
    if (q->capacity < new_capacity) {
      if (q->task_queues != NULL) {
        memcpy(
          queues_to_free, q->task_queues, sizeof(em_task_queue*) * q->size);
      }
      em_task_queue** old_task_queues = q->task_queues;
      q->task_queues = queues_to_free;
      q->capacity = new_capacity;
      queues_to_free = old_task_queues;
    }
  }
  q->task_queues[q->size++] = new_tasks;
  pthread_mutex_unlock(&q->mutex);
  tasks = new_tasks;
  new_tasks = NULL;

out:
  if (queues_to_free != NULL) {
    free(queues_to_free);
  }
  if (new_tasks != NULL) {
    em_task_queue_destroy(new_tasks);
  }
  return tasks;
}'''

OLD_DO_PROXY = '''  pthread_mutex_lock(&q->mutex);
  em_task_queue* tasks = get_or_add_tasks_for_thread(q, target_thread);
  pthread_mutex_unlock(&q->mutex);
  if (tasks == NULL) {'''

NEW_DO_PROXY = '''  em_task_queue* tasks = get_or_add_tasks_for_thread(q, target_thread);
  if (tasks == NULL) {'''


def main():
    if len(sys.argv) != 2:
        sys.exit('usage: apply-emscripten-patches.py <emscripten-fork-dir>')
    path = Path(sys.argv[1]) / 'system/lib/pthread/proxying.c'
    src = path.read_text()
    if MARK in src:
        if OLD_DO_PROXY in src:
            sys.exit('proxying.c: marker present but do_proxy still locks around get_or_add')
        print('proxying.c: already patched')
        return
    for name, old in (('get_or_add_tasks_for_thread', OLD_GET_OR_ADD), ('do_proxy', OLD_DO_PROXY)):
        if src.count(old) != 1:
            sys.exit(f'proxying.c: anchor for {name} found {src.count(old)} times (expected 1); fork changed?')
    src = src.replace(OLD_GET_OR_ADD, NEW_GET_OR_ADD).replace(OLD_DO_PROXY, NEW_DO_PROXY)
    if src.count('get_or_add_tasks_for_thread(q,') != 1:
        sys.exit('proxying.c: unexpected callers of get_or_add_tasks_for_thread')
    path.write_text(src)
    print('proxying.c: patched (emscripten#28186 backport)')


if __name__ == '__main__':
    main()
