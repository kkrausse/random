import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Activity } from '../domain/activity'
import { RouteThumbnail } from './RouteThumbnail'

const miles = (meters: number) => meters / 1609.344

const duration = (seconds: number | null) => {
  if (seconds === null) return '—'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

const speedOrPace = (activity: Activity) => {
  if (!activity.distanceM || !activity.durationSeconds) return '—'
  const distanceMiles = miles(activity.distanceM)
  if (activity.sport.toLowerCase().includes('run') || activity.sport.toLowerCase().includes('walk')) {
    const paceSeconds = activity.durationSeconds / distanceMiles
    return `${Math.floor(paceSeconds / 60)}:${String(Math.round(paceSeconds % 60)).padStart(2, '0')} /mi`
  }
  return `${(distanceMiles / (activity.durationSeconds / 3600)).toFixed(1)} mph`
}

function SortHeader({ column, children }: { column: Column<Activity>; children: string }) {
  const sorted = column.getIsSorted()
  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown

  return (
    <button className="sort-button" type="button" onClick={column.getToggleSortingHandler()}>
      {children}
      <Icon aria-hidden="true" />
    </button>
  )
}

const columns: ColumnDef<Activity>[] = [
  {
    id: 'route',
    header: 'Route',
    enableSorting: false,
    cell: ({ row }) => <RouteThumbnail points={row.original.route} />,
  },
  {
    accessorKey: 'startedAt',
    header: ({ column }) => <SortHeader column={column}>Date</SortHeader>,
    cell: ({ row }) => {
      const date = new Date(row.original.startedAt)
      return (
        <div className="date-cell">
          <strong>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)}</strong>
          <span>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)}</span>
        </div>
      )
    },
  },
  {
    accessorKey: 'sport',
    header: ({ column }) => <SortHeader column={column}>Type</SortHeader>,
    cell: ({ row }) => <span className={`sport sport-${row.original.sport.toLowerCase()}`}>{row.original.sport.replaceAll('_', ' ')}</span>,
  },
  {
    accessorKey: 'distanceM',
    header: ({ column }) => <SortHeader column={column}>Distance</SortHeader>,
    cell: ({ getValue }) => {
      const value = getValue<number | null>()
      return <span className="numeric">{value === null ? '—' : `${miles(value).toFixed(1)} mi`}</span>
    },
  },
  {
    accessorKey: 'durationSeconds',
    header: ({ column }) => <SortHeader column={column}>Time</SortHeader>,
    cell: ({ getValue }) => <span className="numeric">{duration(getValue<number | null>())}</span>,
  },
  {
    id: 'speed',
    accessorFn: (activity) => activity.distanceM && activity.durationSeconds ? activity.distanceM / activity.durationSeconds : null,
    header: ({ column }) => <SortHeader column={column}>Speed / pace</SortHeader>,
    cell: ({ row }) => <span className="numeric">{speedOrPace(row.original)}</span>,
  },
  {
    accessorKey: 'ascentM',
    header: ({ column }) => <SortHeader column={column}>Climb</SortHeader>,
    cell: ({ getValue }) => {
      const value = getValue<number | null>()
      return <span className="numeric">{value === null ? '—' : `${Math.round(value * 3.28084).toLocaleString()} ft`}</span>
    },
  },
  {
    accessorKey: 'avgHrBpm',
    header: ({ column }) => <SortHeader column={column}>Avg HR</SortHeader>,
    cell: ({ getValue }) => {
      const value = getValue<number | null>()
      return <span className="numeric hr">{value === null ? '—' : Math.round(value)}</span>
    },
  },
]

export function WorkoutTable({ activities }: { activities: ReadonlyArray<Activity> }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'startedAt', desc: true }])
  const data = useMemo(() => [...activities], [activities])
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  if (activities.length === 0) {
    return (
      <div className="empty-state">
        <p>No indexed workouts yet.</p>
        <code>bun run garmin:login</code>
        <code>bun run garmin:sync</code>
        <code>bun run build:data</code>
      </div>
    )
  }

  return (
    <section className="data-table" aria-label="Workouts">
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>Showing {table.getRowModel().rows.length} of {activities.length} activities</span>
        <div className="pagination">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <button type="button" aria-label="Previous page" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft /></button>
          <button type="button" aria-label="Next page" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><ChevronRight /></button>
        </div>
      </div>
    </section>
  )
}
