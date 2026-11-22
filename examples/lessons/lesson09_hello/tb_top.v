// Тестбенч урока 9, практика 2: жмём S1 дважды и принимаем всё, что пришло
// по UART. Ожидаем дважды «Hello\r\n» — 14 байт.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;
    localparam integer BIT_NS = 370;  // CLK_HZ = 1000, BAUD = 100: бит = 10 тактов

    reg        clk = 1'b0;
    reg        btn = 1'b0;
    wire       tx;
    wire [5:0] led;

    always #18.5 clk = ~clk;

    top #(.CLK_HZ(1000), .BAUD(100)) dut (.clk(clk), .btn_s1(btn),
                                         .uart_tx(tx), .led(led));

    // ---------- Приёмник в тестбенче: складывает байты в массив ----------
    reg [7:0] b;
    reg [7:0] rx_buf [0:31];
    integer   k, got = 0, errors = 0;

    always begin
        @(negedge tx);
        #(BIT_NS / 2);
        if (tx !== 1'b0) errors = errors + 1;   // нет старт-бита
        for (k = 0; k < 8; k = k + 1) begin
            #(BIT_NS);
            b[k] = tx;
        end
        #(BIT_NS);
        if (tx !== 1'b1) errors = errors + 1;   // нет стоп-бита
        rx_buf[got] = b;
        got = got + 1;
    end

    task move (input v);
        integer j;
        begin
            for (j = 0; j < BOUNCE; j = j + 1) begin
                btn = v;   #60;
                btn = ~v;  #40;
            end
            btn = v;  #1500;
        end
    endtask

    reg [8*7-1:0] want = {"Hello", 8'h0D, 8'h0A};  // 7 байт, первый — старший
    integer n;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        repeat (2) begin
            move(1'b1);  move(1'b0);
            #30000;                           // 7 кадров × 3700 нс = 25 900 нс
        end
        $write("принято %0d байт: ", got);
        for (n = 0; n < got; n = n + 1) begin
            if      (rx_buf[n] == 8'h0D) $write("\\r");
            else if (rx_buf[n] == 8'h0A) $write("\\n");
            else if (rx_buf[n] >= 8'h20 && rx_buf[n] < 8'h7F)
                                         $write("%c", rx_buf[n]);
            else                         $write(".");     // непечатный байт
            if (rx_buf[n] !== want[8*(6 - n % 7) +: 8]) errors = errors + 1;
        end
        $display("");
        $display("строк отправлено (LED) %0d", ~led);
        if (got != 14 || ~led != 6'd2) errors = errors + 1;
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
