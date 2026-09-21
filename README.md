# Fleet Maintenance

Fleet Maintenance is a web-based vehicle maintenance management system.

It helps fleet managers manage vehicles, maintenance schedules, job orders,
technicians, spare parts, service history and maintenance costs in one place.

## Features

- Vehicle / Fleet Management
- Preventive Maintenance Scheduling
- Job Order Management
- Technician Assignment
- Spare Parts Inventory
- Service History
- Maintenance Cost Tracking
- Dashboard
- REST API

## Project Architecture

```mermaid
flowchart TD
    A[User / Fleet Manager] --> B[Frontend]

    B --> C[REST API]

    C --> D[Backend - Node.js + Express]

    D --> E[(Database)]

    D --> F[Vehicle Management]
    D --> G[Maintenance Schedule]
    D --> H[Job Orders]
    D --> I[Parts Inventory]
    D --> J[Service History]
