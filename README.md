# E-Commerce Management Dashboard

A full-stack e-commerce management dashboard built for the Iranian
market. The project is being developed incrementally, with a focus on a
maintainable backend, reliable data integrity, and a scalable foundation
for store operations.

> **Project status:** Backend development is in progress. Product,
> catalog, authentication, and inventory foundations are implemented.
> Order and payment management is the current development focus.

## Tech Stack

### Frontend

-   React
-   TypeScript
-   Tailwind CSS

### Backend

-   Node.js
-   Express
-   TypeScript
-   Prisma ORM

### Database

-   PostgreSQL

### Backend Testing

-   Vitest
-   Supertest

## Core Areas

The dashboard is planned to cover the main operational areas of an
e-commerce business:

-   Authentication and authorization
-   Product catalog management
-   Categories and brands
-   Product attributes and variants
-   Product image management
-   Warehouse and inventory management
-   Stock movements and inventory workflows
-   Order management
-   Payment management and payment gateway integrations
-   Shipping and returns
-   Dashboard APIs and reporting

Features in the list above are part of the project scope; their
implementation status is tracked in the roadmap below.

## Project Structure

``` text
ecommerce-management-dashboard/
├── frontend/
├── backend/
│   ├── prisma/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── middlewares/
│   │   └── utils/
│   ├── tests/
│   └── prisma7.config.ts
├── README.md
└── .gitignore
```

## Development Progress

-   [x] Phase 01 --- Project Planning & Requirements Analysis
-   [x] Phase 02 --- Database Architecture & Design
-   [x] Phase 03 --- ER Diagram Design
-   [x] Phase 04 --- Database Environment Setup
-   [x] Phase 05 --- Backend & ORM Setup
-   [x] Phase 06 --- Prisma Schema Development
-   [x] Phase 07 --- Database Migration & Validation
-   [x] Phase 08 --- Authentication & Authorization
-   [x] Phase 09 --- Product & Inventory Management
-   [ ] Phase 10 --- Order & Payment Management
    -   [x] 10.00 --- Architecture & Schema Audit
    -   [x] 10.01 --- Order Management
    -   [x] 10.02 --- Order Items & Pricing
    -   [ ] 10.03 --- Order Status & History
    -   [ ] 10.04 --- Payment Provider Management
    -   [ ] 10.05 --- Payment Management
    -   [ ] 10.06 --- Payment Attempts & Webhooks
    -   [ ] 10.07 --- Refund Management
    -   [ ] 10.08 --- Inventory & Order Integration
    -   [ ] 10.09 --- Integration & Regression Testing
-   [ ] Phase 11 --- Shipping & Returns Management
-   [ ] Phase 12 --- Dashboard API Development
-   [ ] Phase 13 --- Frontend Development
-   [ ] Phase 14 --- Testing & Optimization
-   [ ] Phase 15 --- Deployment & Documentation

## Development Setup

### Prerequisites

Install the following before setting up the project:

-   Node.js and npm
-   PostgreSQL
-   Git

### Backend

1.  Clone the repository.

2.  Open the `backend` directory.

3.  Install the dependencies:

    ``` bash
    npm install
    ```

4.  Configure the database connection and other required environment
    variables using the project's environment configuration.

5.  Apply the database migrations:

    ``` bash
    npx prisma migrate deploy --config prisma7.config.ts
    ```

6.  Generate the Prisma Client:

    ``` bash
    npx prisma generate --config prisma7.config.ts
    ```

> The exact development and start commands depend on the scripts
> configured in `backend/package.json`.

### Tests

The backend test suite uses Vitest. Run the tests from the `backend`
directory:

``` bash
npx vitest run --maxWorkers=1
```

Integration tests use the test environment configuration. Make sure the
test database is configured separately from the development database
before running them.

## Project Notes

-   The initial target market is Iran.
-   The application uses the Iranian rial (IRR) for monetary values.
-   Payment gateway integrations are planned as part of the order and
    payment development phase.
-   The project is being developed in phases; roadmap checkboxes
    indicate completed work, not merely planned scope.

## License

No license has been selected yet. Until a license is added, all rights
are reserved by the copyright holder.
