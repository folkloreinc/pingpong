import type { PanneauPlugin } from '@panneau/core';

import { CodeDisplay } from './components/CodeDisplay.tsx';
import { catalogs } from './messages/index.ts';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { CreateProject } from './project/CreateProject.tsx';
import { ProjectLive } from './project/ProjectLive.tsx';
import { ProjectSecret } from './project/ProjectSecret.tsx';

/** The dashboard's pages, layout components, actions, displays and messages. */
export const dashboardPlugin: PanneauPlugin = {
    id: 'pingpong',
    locales: catalogs,
    pages: {
        'pingpong-overview': OverviewPage,
    },
    actions: {
        'pingpong-create-project': CreateProject,
    },
    components: {
        'pingpong-project-secret': ProjectSecret,
        'pingpong-project-live': ProjectLive,
    },
    displays: {
        'pingpong-code': CodeDisplay,
    },
};
