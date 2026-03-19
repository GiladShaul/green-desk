-- Migration: 002_seed
-- Description: Sample data for development (1 floor, 10 desks, 2 users)

-- Seed users (password_hash is bcrypt of 'password123')
INSERT INTO users (id, email, password_hash, name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@greendesk.com', '$2b$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSm58ZN3pq', 'Admin User', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'alice@greendesk.com', '$2b$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSm58ZN3pq', 'Alice Smith', 'member')
ON CONFLICT (id) DO NOTHING;

-- Seed floor
INSERT INTO floors (id, name, building, floor_number) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Ground Floor', 'Main Building', 1)
ON CONFLICT (id) DO NOTHING;

-- Seed 10 desks on the ground floor
INSERT INTO desks (id, floor_id, label, x_position, y_position, status) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'A-01', 100, 100, 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'A-02', 200, 100, 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'A-03', 300, 100, 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'A-04', 400, 100, 'active'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'A-05', 500, 100, 'active'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'B-01', 100, 200, 'active'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'B-02', 200, 200, 'active'),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'B-03', 300, 200, 'active'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'B-04', 400, 200, 'active'),
  ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'B-05', 500, 200, 'inactive')
ON CONFLICT (id) DO NOTHING;
