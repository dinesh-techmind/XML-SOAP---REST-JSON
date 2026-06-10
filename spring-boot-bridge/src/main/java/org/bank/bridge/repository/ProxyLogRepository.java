package org.bank.bridge.repository;

import org.bank.bridge.entity.ProxyTransactionLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ProxyLogRepository extends JpaRepository<ProxyTransactionLog, Long> {
}
