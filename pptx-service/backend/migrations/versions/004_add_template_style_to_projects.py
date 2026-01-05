"""add template_style to projects

Revision ID: 004_add_template_style
Revises: 38292967f3ca
Create Date: 2025-12-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004_add_template_style'
down_revision = '38292967f3ca'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add template_style field to projects table.
    This field stores the style description when user chooses template-free mode.
    """
    # Add template_style column (nullable, defaults to None)
    op.add_column('projects', sa.Column('template_style', sa.Text(), nullable=True))


def downgrade() -> None:
    """
    Remove template_style field from projects table.
    """
    op.drop_column('projects', 'template_style')

