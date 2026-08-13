import { create } from 'zustand';
import { api } from '../api/client.js';
import type { Project } from '../api/types.js';

interface ProjectsStore {
  projects: Project[];
  loading: boolean;
  error: string | null;
  /** Fetch the active project list and replace store state. */
  load: () => Promise<void>;
  /** Optimistically add a newly-created project. */
  addProject: (p: Project) => void;
  /** Optimistically update a project in-place (rename, archive, restore). */
  updateProject: (p: Project) => void;
}

export const useProjectsStore = create<ProjectsStore>((set) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const { projects } = await api.listProjects();
      set({ projects, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addProject: (p) =>
    set((s) => ({ projects: [p, ...s.projects.filter((x) => x.id !== p.id)] })),

  updateProject: (p) =>
    set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? p : x)) })),
}));
