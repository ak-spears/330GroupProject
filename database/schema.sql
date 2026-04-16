-- TrailBuddy — MySQL schema aligned with the project ERD (reference DDL).
-- If your RDS database already exists, treat this as documentation; only run on empty DBs.
-- Adjust ENUM definitions to match your hosted MySQL if you use ENUM types there.

SET NAMES utf8mb4;

CREATE TABLE employee (
  employeeid INT PRIMARY KEY AUTO_INCREMENT,
  role VARCHAR(25),
  department VARCHAR(25),
  salary DECIMAL(9,2),
  availability VARCHAR(25),
  email VARCHAR(50),
  birthday DATE,
  bonus DECIMAL(9,2)
);

CREATE TABLE employeephone (
  phonenumber CHAR(12) NOT NULL,
  employeeID INT NOT NULL,
  PRIMARY KEY (phonenumber, employeeID),
  FOREIGN KEY (employeeID) REFERENCES employee (employeeid)
);

CREATE TABLE customer (
  customerid INT PRIMARY KEY AUTO_INCREMENT,
  fname VARCHAR(25),
  lname VARCHAR(25),
  email VARCHAR(50),
  password VARCHAR(50),
  birthday DATE,
  registrationdate DATE
);

CREATE TABLE customerphone (
  phonenumber CHAR(12) NOT NULL,
  customerid INT NOT NULL,
  PRIMARY KEY (phonenumber, customerid),
  FOREIGN KEY (customerid) REFERENCES customer (customerid)
);

-- difficultylevel: ERD shows ENUM(...); use ENUM in production or keep VARCHAR for flexibility.
CREATE TABLE hikingtrip (
  tripid INT PRIMARY KEY AUTO_INCREMENT,
  tripname VARCHAR(50),
  location VARCHAR(50),
  distance DECIMAL(5,2),
  date DATE,
  price DECIMAL(9,2),
  numberofhikers INT,
  difficultylevel VARCHAR(25),
  category VARCHAR(25),
  time TIME
);

-- resstatus: ERD shows ENUM(...); align with your live column type.
CREATE TABLE reservation (
  reservationid INT PRIMARY KEY AUTO_INCREMENT,
  reservationdate DATE,
  numberofhikers INT,
  resstatus VARCHAR(25),
  reservationtime TIME,
  customerid INT NOT NULL,
  tripid INT NOT NULL,
  employeeid INT NOT NULL,
  FOREIGN KEY (customerid) REFERENCES customer (customerid),
  FOREIGN KEY (tripid) REFERENCES hikingtrip (tripid),
  FOREIGN KEY (employeeid) REFERENCES employee (employeeid)
);

CREATE TABLE supervises (
  employeeid INT NOT NULL,
  tripid INT NOT NULL,
  PRIMARY KEY (employeeid, tripid),
  FOREIGN KEY (employeeid) REFERENCES employee (employeeid),
  FOREIGN KEY (tripid) REFERENCES hikingtrip (tripid)
);
