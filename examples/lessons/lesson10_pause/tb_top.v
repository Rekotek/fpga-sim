// Тестбенч варианта ★: радуга идёт, S1 — стоп (оттенок не меняется
// несколько кадров), S1 ещё раз — радуга идёт дальше.
`timescale 1ns / 100ps

module tb_top;
    reg  clk = 1'b0;
    reg  s1  = 1'b0;
    wire ws;

    always #18.5 clk = ~clk;

    top #(.STEP_HZ(27_000), .DB_HZ(1_000_000)) dut (.clk(clk), .btn_s1(s1), .ws2812(ws));

    integer errors = 0;
    reg [7:0] h0;

    task press;
        begin
            s1 = 1'b1;  #5000;
            s1 = 1'b0;  #5000;
        end
    endtask

    initial begin
        #1_000_000;                       // 1 мс: радуга идёт
        h0 = dut.hue;
        $display("идёт:   оттенок %0d", h0);
        if (h0 == 8'd0) errors = errors + 1;
        press;  h0 = dut.hue;
        #2_000_000;                       // 2 мс стоим
        $display("стоп:   оттенок %0d -> %0d через 2 мс", h0, dut.hue);
        if (dut.hue !== h0) errors = errors + 1;
        press;
        #1_000_000;
        $display("пуск:   оттенок %0d -> %0d через 1 мс", h0, dut.hue);
        if (dut.hue == h0) errors = errors + 1;
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
