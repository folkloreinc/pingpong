import type {
    ActionInput,
    Auth,
    DefinitionInput,
    Field,
    LayoutNode,
    ResourceInput,
    User,
} from '@panneau/protocol';
import type { IntlShape } from 'react-intl';

import { type Locale, type MessageId, t } from './messages/index.ts';
import { TONES } from './tones.ts';

export interface DefinitionOptions {
    intl: IntlShape;
    locale: Locale;
    /** The URL of the admin API. */
    baseUrl: string;
    user: User;
}

/** The path of the dashboard, for links. */
export const BASE_PATH = '/dashboard';

/** The pattern of a project's id, as the protocol's `ProjectId`. */
export const PROJECT_ID = '^[a-z0-9][a-z0-9-]{0,62}$';

/** The limits a project can set, as fields of its form. */
export const LIMITS = [
    'maxConnections',
    'maxMessagesPerSecond',
    'maxMessageSize',
    'maxChannelsPerSocket',
] as const;

function helpers(intl: IntlShape) {
    const m = (id: MessageId, values?: Record<string, string | number>) => t(intl, id, values);
    const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({
        name,
        type,
        label: m(`projects.fields.${name}` as MessageId),
        ...extra,
    });
    const row = (...children: [string, number][]): LayoutNode => ({
        type: 'row',
        children: children.map(([name, width]) => ({ type: 'field', name, width })),
    });
    return { m, field, row };
}

/** The fields that make a project, for its form and for the dialog that creates one. */
export function projectFields(intl: IntlShape): Field[] {
    const { m, field } = helpers(intl);
    return [
        field('name', 'text', { rules: [{ rule: 'required' }] }),
        field('id', 'text', {
            createOnly: true,
            help: m('projects.help.id'),
            rules: [{ rule: 'required' }, { rule: 'pattern', value: PROJECT_ID }],
        }),
        field('origins', 'tags', { help: m('projects.help.origins') }),
        ...LIMITS.map((name) =>
            field(name, 'number', {
                placeholder: m('projects.serverDefault'),
                rules: [{ rule: 'min', value: name === 'maxMessageSize' ? 64 : 1 }],
                ...(name === 'maxMessageSize'
                    ? { help: m('projects.help.maxMessageSize'), settings: { suffix: 'B' } }
                    : {}),
            }),
        ),
    ];
}

function projectsResource(intl: IntlShape): ResourceInput {
    const { m, field, row } = helpers(intl);
    const status = ['active', 'disabled'].map((value) => ({
        value,
        label: m(`status.${value}` as MessageId),
        ...(TONES[value] !== undefined ? { tone: TONES[value] } : {}),
    }));
    // Live counters: columns of the list, not fields, so the form doesn't show them.
    const count = (id: string) => ({
        id,
        label: m(`projects.fields.${id}` as MessageId),
        display: 'number',
        align: 'end' as const,
    });
    const actions: ActionInput[] = [
        {
            id: 'new',
            label: m('projects.actions.new'),
            icon: 'plus',
            // A dialog of the dashboard: it shows the new project's secret, once.
            kind: 'client',
            component: 'pingpong-create-project',
            scope: ['resource'],
            placement: ['toolbar'],
        },
        {
            id: 'disable',
            label: m('projects.actions.disable'),
            icon: 'circle-off',
            scope: ['item'],
            placement: ['form', 'row'],
            destructive: true,
            confirm: {
                title: m('projects.actions.disableTitle'),
                message: m('projects.actions.disableMessage'),
                confirmLabel: m('projects.actions.disable'),
            },
        },
        {
            id: 'enable',
            label: m('projects.actions.enable'),
            icon: 'circle-check',
            scope: ['item'],
            placement: ['form', 'row'],
        },
        {
            id: 'delete',
            label: m('projects.actions.delete'),
            icon: 'trash-2',
            scope: ['item'],
            placement: ['form'],
            destructive: true,
            confirm: {
                title: m('projects.actions.deleteTitle'),
                message: m('projects.actions.deleteMessage'),
                confirmLabel: m('projects.actions.delete'),
            },
        },
    ];
    return {
        id: 'projects',
        label: { singular: m('projects.singular'), plural: m('projects.plural') },
        description: m('projects.description'),
        icon: 'radio-tower',
        itemTitle: 'name',
        itemSubtitle: 'id',
        // Projects are created by the `new` action, which shows the secret.
        abilities: { viewAny: true, create: false },
        fields: [
            ...projectFields(intl),
            field('status', 'select', { readOnly: true, options: status }),
            field('key', 'text', {
                readOnly: true,
                help: m('projects.help.key'),
                display: 'pingpong-code',
            }),
        ],
        form: {
            layout: [
                row(['name', 6], ['id', 4], ['status', 2]),
                { type: 'field', name: 'key' },
                { type: 'component', component: 'pingpong-project-secret' },
                { type: 'field', name: 'origins' },
                {
                    type: 'section',
                    label: m('projects.sections.limits'),
                    description: m('projects.help.limits'),
                    children: [
                        row(
                            ['maxConnections', 3],
                            ['maxMessagesPerSecond', 3],
                            ['maxMessageSize', 3],
                            ['maxChannelsPerSocket', 3],
                        ),
                    ],
                },
                {
                    type: 'section',
                    label: m('projects.sections.live'),
                    children: [{ type: 'component', component: 'pingpong-project-live' }],
                },
            ],
        },
        list: {
            columns: [
                { field: 'name' },
                { field: 'id', display: 'pingpong-code' },
                { field: 'status' },
                count('connections'),
                count('peakConnections'),
                count('messages'),
                count('rateLimited'),
                count('messages30'),
                {
                    id: 'createdAt',
                    label: m('projects.fields.createdAt'),
                    display: 'datetime',
                    align: 'end',
                },
            ],
            filters: [
                {
                    id: 'status',
                    type: 'select',
                    label: m('projects.fields.status'),
                    options: status,
                },
            ],
            sorts: ['name', 'id', 'connections', 'messages', 'messages30', 'createdAt'],
            defaultSort: 'name',
            search: true,
            perPage: 50,
        },
        actions,
    };
}

/**
 * How the operator signs in: the server's admin token, on Panneau's login page, which shows before
 * the definition (decision 0009). In the boot config and in the definition.
 */
export function createAuth(intl: IntlShape): Auth {
    return {
        mode: 'panneau',
        token: { label: t(intl, 'login.token'), help: t(intl, 'login.tokenHelp') },
    };
}

/**
 * The dashboard's definition: Pingpong implements no Panneau protocol, so the definition is
 * static, in the operator's locale, and the adapter maps it onto the admin API (decision 0009).
 */
export function createDefinition({
    intl,
    locale,
    baseUrl,
    user,
}: DefinitionOptions): DefinitionInput {
    return {
        protocol: 1,
        name: t(intl, 'app.name'),
        locale,
        locales: [locale],
        api: { baseUrl },
        resources: [projectsResource(intl)],
        pages: {
            // The overview is the home: the sidebar's first link.
            home: { component: 'pingpong-overview', label: t(intl, 'overview.title') },
            usage: { component: 'pingpong-usage', label: t(intl, 'usage.title') },
        },
        menus: {
            main: [
                { type: 'resource', resource: 'projects' },
                { type: 'page', page: 'usage', icon: 'chart-line' },
            ],
        },
        auth: createAuth(intl),
        search: { enabled: false },
        user,
    };
}
