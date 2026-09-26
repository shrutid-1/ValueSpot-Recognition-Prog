# Department Management Feature - Quick Reference

## 🎯 What Was Added

A new **Department Management** page for HR Admins to manage company departments.

## 📍 Where to Find It

- **URL**: `/hr/departments`
- **Sidebar**: Under "Manage" section, between "Employees" and "Projects"
- **Icon**: Building2
- **Access**: HR Admin and Super Admin only

## 🛠 Features

| Feature | Action | Details |
|---------|--------|---------|
| **List** | View all | Shows name, description, status (active/archived) |
| **Add** | Create | Modal form: Name (required) + Description (optional) |
| **Edit** | Update | Click pencil icon, modify name/description |
| **Archive** | Deactivate | Click archive icon, confirm to archive |
| **Restore** | Reactivate | Click rotate icon on archived, confirm to restore |
| **Empty** | No data | Shows helpful message with action button |
| **Mobile** | Responsive | Table adapts to small screens, columns hide |

## 📁 Files Changed

### New Files
- `src/pages/hr/DepartmentsPage.tsx` - Main page component

### Modified Files
- `src/lib/constants.ts` - Added route `DEPARTMENTS: '/hr/departments'`
- `src/app/router.tsx` - Added import and route with protection
- `src/components/layout/Sidebar.tsx` - Added navigation item

## 🗄 Database

**Table**: `public.departments`

**Fields Used**:
- `id` - UUID primary key
- `name` - Department name (string)
- `description` - Department description (text, optional)
- `is_active` - Status (boolean)
- `archived_at` - Archive timestamp (for soft delete)

## 🔐 Security

- **Access Control**: `ProtectedRoute` with role check `['hr_admin', 'super_admin']`
- **URL Protection**: Only accessible via authenticated route
- **Data Validation**: Name required, description optional
- **No XSS**: Proper React escaping
- **RLS**: Supabase Row Level Security policies apply

## 💻 Design System

- **Typography**: Barlow/Barlow Condensed (matches other pages)
- **Colors**: CSS variables (--color-text, --color-divider, etc.)
- **Spacing**: 4px grid (12px, 16px, 20px, etc.)
- **Components**: vs-card, vs-table, vs-tag, vs-btn with corner marks
- **Icons**: Lucide React (Building2, Plus, Edit2, Archive, RotateCcw, X)
- **Pattern**: Same as Employees, Projects, Core Values pages

## 🧪 Testing

To verify it works:

1. Log in as HR Admin
2. Click "Departments" in sidebar (under Manage section)
3. You should see:
   - Page title "Departments"
   - "Add Department" button
   - Table with existing departments (if any exist)
   - Or empty state if no departments
4. Try adding a new department
5. Try editing an existing department
6. Try archiving/restoring a department

## 📝 Usage Example

```typescript
// Add new department
const form = { name: 'Engineering', description: 'Software development team' }
// → Insert into public.departments with is_active = true

// Edit department
const form = { name: 'Engineering Team', description: 'Updated description' }
// → Update public.departments set name, description

// Archive department
const department = { id: 'xxx', is_active: true }
// → Update public.departments set is_active = false, archived_at = now()

// Restore department
const department = { id: 'xxx', is_active: false }
// → Update public.departments set is_active = true, archived_at = null
```

## 🚀 Deployment

- **Status**: Ready for production
- **No Breaking Changes**: All existing features work unchanged
- **Database Impact**: None (uses existing table)
- **Rollback**: Simple (delete files, revert constants/router/sidebar)

## 📚 Architecture Pattern

The page follows the same pattern as other management pages:

```
PageHeader (with Add button)
    ↓
LoadingState / EmptyState / DataTable
    ↓
FormDialog (for Add/Edit)
    ↓
ConfirmModal (for Archive/Restore)
```

## 🔗 Related Pages

- **Employees** (`/hr/employees`) - Employee management
- **Projects** (`/hr/projects`) - Project management
- **Core Values** (`/hr/core-values`) - Value management
- **Behaviours** (`/hr/behaviours`) - Behavior management

All follow the same UI/UX patterns for consistency.

## 💡 Future Enhancements (Optional)

- Department manager assignment
- Department budget tracking
- Team member list per department
- Search/filter functionality
- Department hierarchy/tree view
- Bulk operations

## 📞 Support

For issues or questions:
1. Check the DEPARTMENTS_FEATURE_IMPLEMENTATION.md for detailed docs
2. Review DEPARTMENTS_VERIFICATION.txt for verification results
3. Check other management pages for pattern reference
