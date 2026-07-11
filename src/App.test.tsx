import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('tree browser', () => {
  it('navigates, creates, and searches notes', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Examples'))
    expect(screen.getByRole('button', { name: /Boolean/i })).toBeInTheDocument()
    fireEvent.click(screen.getByText('+ New entry'))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'New' } })
    fireEvent.change(screen.getByPlaceholderText('Text or any JSON value'), { target: { value: 'true' } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('New')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Search keys/), { target: { value: 'New' } })
    expect(screen.getByText('/Examples/New')).toBeInTheDocument()
  })
  it('preserves input when validation fails', () => {
    render(<App />); fireEvent.click(screen.getByText('+ New entry'))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'Examples' } })
    fireEvent.change(screen.getByPlaceholderText('Text or any JSON value'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/)
    expect(screen.getByDisplayValue('draft')).toBeInTheDocument()
  })
  it('confirms destructive deletion', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false); render(<App />)
    fireEvent.click(screen.getAllByText('Delete')[0]); expect(window.confirm).toHaveBeenCalled()
  })
})
